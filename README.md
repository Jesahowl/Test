# Shopping list price tracker

A small, dependency-free web dashboard for a shopping list that compares
**Woolworths** and **Coles** prices and keeps a dated history of every price change.

Open `index.html` in a browser (or serve the folder with any static server) to use it.

## Features

- **Totals at a glance**: what the list costs all at Woolworths, all at Coles,
  and the cheapest split between the two (with the saving).
- **Per-item comparison**: the cheaper store is highlighted with how much you save each.
- **Price history**: each price change is stored with its date. Rows show the change
  since the last price (▲/▼ with %) and a sparkline; *History* opens a full chart
  and a list of entries you can delete.
- **Quick lookup**: "Search Woolies" / "Search Coles" links open each store's
  search for that item.
- Quantities, tick off bought items, filter (All / To buy / Bought), clear bought.
- Export / import the list as JSON. Data is saved in the browser's local storage.
- Works on phones and follows the system light/dark theme.

## Why prices are entered manually

Woolworths and Coles don't provide a public pricing API, and their websites block
cross-site requests from the browser, so the dashboard can't fetch prices on its own.
Use the search links to check the current price and type it in; the dashboard
handles the comparison and history.

## Files

- `index.html`: page layout
- `style.css`: styles
- `app.js`: list logic, totals, history and charts
