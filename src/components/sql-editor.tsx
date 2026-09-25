import { SQLDialect, SQLite, sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { type Ref, useImperativeHandle, useMemo, useRef } from "react";
import { formatDialect, sqlite } from "sql-formatter";
import type { TableInfo } from "#/server/sql";

// lang-sql's SQLite dialect extends the SQL-standard keyword list, which marks
// ordinary SQLite identifiers such as `method`, `value` or `data` as keywords,
// and its `builtin` list holds sqlite3 CLI dot-commands. These lists follow
// sqlite.org/lang_keywords.html and SQLite's built-in function pages.
const dialect = SQLDialect.define({
	...SQLite.spec,
	keywords:
		"abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade case cast check collate column commit conflict constraint create cross current current_date current_time current_timestamp database default deferrable deferred delete desc detach distinct do drop each else end escape except exclude exclusive exists explain fail filter first following for foreign from full generated glob group groups having if ignore immediate in index indexed initially inner insert instead intersect into is isnull join key last left like limit match materialized natural no not nothing notnull nulls of offset on or order others outer over partition plan pragma preceding primary query raise range recursive references regexp reindex release rename replace restrict returning right rollback row rows savepoint select set table temp temporary then ties to transaction trigger unbounded union unique update using vacuum values view virtual when where window with without",
	builtin:
		"abs avg changes char coalesce concat concat_ws count format group_concat hex ifnull iif instr last_insert_rowid length likelihood likely lower ltrim max min nullif octet_length printf quote random randomblob round rtrim sign soundex sqlite_version string_agg substr substring sum total total_changes trim typeof unhex unicode unlikely upper zeroblob date time datetime julianday unixepoch strftime timediff acos asin atan atan2 ceil ceiling cos degrees exp floor ln log log10 log2 mod pi pow power radians sin sqrt tan trunc json jsonb json_array json_array_length json_each json_extract json_group_array json_group_object json_insert json_object json_patch json_quote json_remove json_replace json_set json_tree json_type json_valid row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value nth_value pragma_table_info pragma_index_list",
});

const theme = EditorView.theme({
	"&": {
		backgroundColor: "var(--card)",
		color: "var(--foreground)",
		fontSize: "0.875rem",
	},
	"&.cm-focused": { outline: "none" },
	".cm-scroller": {
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		lineHeight: "1.6",
	},
	".cm-content": { caretColor: "var(--foreground)", padding: "0.75rem 0" },
	".cm-cursor": { borderLeftColor: "var(--foreground)" },
	".cm-gutters": {
		backgroundColor: "var(--card)",
		color: "var(--muted-foreground)",
		border: "none",
	},
	".cm-activeLine, .cm-activeLineGutter": {
		backgroundColor: "color-mix(in oklch, var(--muted) 45%, transparent)",
	},
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
		{ backgroundColor: "var(--syntax-selection) !important" },
	".cm-tooltip": {
		backgroundColor: "var(--card)",
		border: "1px solid var(--border)",
		borderRadius: "0.375rem",
	},
	".cm-tooltip-autocomplete ul li[aria-selected]": {
		backgroundColor: "var(--muted)",
		color: "var(--foreground)",
	},
});

const highlight = HighlightStyle.define([
	{ tag: t.keyword, color: "var(--syntax-keyword)" },
	{ tag: [t.string, t.special(t.string)], color: "var(--syntax-string)" },
	{ tag: [t.number, t.bool, t.null], color: "var(--syntax-number)" },
	{ tag: [t.standard(t.name), t.typeName], color: "var(--syntax-builtin)" },
	{
		tag: [t.lineComment, t.blockComment],
		color: "var(--muted-foreground)",
		fontStyle: "italic",
	},
	{ tag: [t.operator, t.punctuation], color: "var(--muted-foreground)" },
]);

export function formatSql(sql: string) {
	// Imports only the SQLite dialect; `format` would bundle every dialect.
	return formatDialect(sql, {
		dialect: sqlite,
		keywordCase: "upper",
		tabWidth: 2,
	});
}

// Formats the whole document as one transaction, so a single undo restores the
// original text. Returns sql-formatter's parse error, if any.
function formatView(view: EditorView): string | null {
	const current = view.state.doc.toString();
	let formatted: string;
	try {
		formatted = formatSql(current);
	} catch (err) {
		return err instanceof Error ? err.message.split("\n")[0] : String(err);
	}
	if (formatted !== current) {
		view.dispatch({
			changes: { from: 0, to: current.length, insert: formatted },
			userEvent: "input.format",
		});
	}
	return null;
}

export type SqlEditorHandle = {
	format(): void;
	// Replaces the document through the editor. Use this rather than the
	// `value` prop: @uiw/react-codemirror defers `value` updates while the user
	// is typing and can drop them.
	setDoc(sql: string): void;
};

type Props = {
	value: string;
	onChange: (value: string) => void;
	onRun: (sql: string) => void;
	// Called with sql-formatter's parse error, or null after a clean format.
	onFormatResult: (error: string | null) => void;
	schema?: TableInfo[];
	ref?: Ref<SqlEditorHandle>;
};

export function SqlEditor({
	value,
	onChange,
	onRun,
	onFormatResult,
	schema,
	ref,
}: Props) {
	const cm = useRef<ReactCodeMirrorRef>(null);
	// Keymaps are built once; the ref keeps them calling the latest handlers.
	const handlers = useRef({ onRun, onFormatResult });
	handlers.current = { onRun, onFormatResult };

	useImperativeHandle(ref, () => ({
		format() {
			const view = cm.current?.view;
			if (view) handlers.current.onFormatResult(formatView(view));
		},
		setDoc(sql) {
			const view = cm.current?.view;
			if (!view || view.state.doc.toString() === sql) return;
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: sql },
			});
		},
	}));

	const keys = useMemo(
		() =>
			// Highest precedence: the default keymap binds Mod-Enter to
			// insertBlankLine.
			Prec.highest(
				keymap.of([
					{
						key: "Mod-Enter",
						run: (view) => {
							handlers.current.onRun(view.state.doc.toString());
							return true;
						},
					},
					{
						// Not Shift-Alt-f: on macOS Option+letter types a character, and
						// CodeMirror does not map those back to key bindings.
						key: "Mod-Shift-f",
						run: (view) => {
							handlers.current.onFormatResult(formatView(view));
							return true;
						},
					},
				]),
			),
		[],
	);

	const language = useMemo(
		() =>
			sql({
				dialect,
				upperCaseKeywords: true,
				schema: Object.fromEntries(
					(schema ?? []).map((table) => [
						table.name,
						table.columns.map((c) => c.name),
					]),
				),
			}),
		[schema],
	);

	return (
		<CodeMirror
			ref={cm}
			value={value}
			onChange={onChange}
			theme={theme}
			extensions={[keys, language, syntaxHighlighting(highlight)]}
			basicSetup={{ foldGutter: false, highlightActiveLineGutter: true }}
			minHeight="10rem"
			maxHeight="24rem"
			className="overflow-hidden rounded-lg border"
		/>
	);
}
