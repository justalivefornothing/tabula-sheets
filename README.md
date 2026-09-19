# Tabula Sheets

A from-scratch browser spreadsheet.

## Features

- Formula engine with tokenizer, parser, dependency graph, and evaluator
- Functions: math, stats, text, logic, lookup, dates
- Canvas grid with virtualized rendering
- Smart-fill, CSV import/export, formatting, undo-friendly command layer
- Local persistence and sample workbooks

## Run

```bash
npm install
npm run dev
```

```bash
npm test
```

## Layout

| Path | Role |
|------|------|
| `src/engine/` | Sheet model, formulas, graph, smart-fill |
| `src/grid/` | Layout, renderer, interaction controller |
| `src/components/` | Toolbar, formula bar, drawers |
| `src/state/` | Store, actions, persistence |

## License

MIT
