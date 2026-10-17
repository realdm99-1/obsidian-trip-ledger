# Trip Ledger

English | [한국어](README.ko.md)

Trip Ledger is an Obsidian plugin for recording expenses by date for each trip and reviewing totals by category and place. The plugin interface defaults to Korean and also supports English. To switch, open **Settings → Trip Ledger → Language**.

## Screenshots

### Dashboard

![Trip Ledger dashboard with the Obsidian sidebar, today's expenses, and recorded dates](screenshots/trip-ledger-dashboard-readme.jpg)

### Statistics

![Trip total and spending by category chart](screenshots/trip-ledger-statistics-readme.jpg)

The screenshots show an example trip with the interface set to English.

## Usage

1. In **Settings → Trip Ledger → Current trip**, select **Create trip**, then enter a trip name and currency code. The plugin creates a separate folder and selects the new trip.
2. Run **Open trip ledger** from the command palette or select the wallet icon in the left ribbon. The dashboard shows today's expenses and the dates with records for the current trip. If no trip is selected yet, the view prompts you to create one in settings.
3. Use **Add expense** on the dashboard to record today's **What**, **Amount**, **Where**, and **Category**. Select a recorded date, or choose another date with the date picker, to open that day's details and add earlier expenses. Select **Back to dashboard** to return. You can edit or delete expenses in either view.
4. Select **Show statistics** to see the trip total. Switch between **By category** for a share chart, **By date** for daily totals, and **By place** for spending by location.
5. In a date's details, select **Open day note** to open its Markdown file in Obsidian. Running **Open trip ledger** again returns to the dashboard.

To edit an earlier trip, use **Settings → Trip Ledger → Select trip folder**. The list includes only direct child folders of the configured ledger folder. Each candidate needs a valid `trip.md`. An invalid folder shows an error and leaves the current selection unchanged. Creating a new trip for a later visit keeps its records separate. Obsidian restores the selected trip on restart; if that trip is missing, select another or create a new one.

Use **Add category** in the category picker to create a custom category. Categories are shared by all trips in the current ledger. In **Settings → Trip Ledger**, you can rename, hide, or show them again. Hidden categories remain in existing records and statistics. You can also change the interface language there.

Under **Settings → Trip Ledger → Ledger folder**, enter a top-level folder name and select **Set folder**. If the target does not exist, the plugin moves the current ledger folder there, or saves only the name if there is no current folder. If the target exists, the plugin connects to it without moving, editing, or merging files. A folder with valid trips, a valid `categories.md` and no trip metadata, or unrelated content without ledger metadata can be used; existing content is preserved. An invalid `categories.md`, or malformed or duplicate `trip.md` metadata with no valid trip, causes an error. This check reads `categories.md` and immediate child folders' `trip.md`, not day files.

The **Settings → Trip Ledger → Select existing ledger** list remains available for top-level vault folders with at least one valid trip `trip.md`, including ledgers renamed outside the plugin. For a connected ledger with valid trips, a saved trip ID stays selected only if it uniquely matches one trip. Without a saved ID, the sole valid trip is selected automatically; if there are multiple, select one under **Select trip folder**. A saved ID with no unique match is cleared; select a trip there even if only one valid trip exists. On restart, the plugin uses the saved ledger path.

## Storage and privacy

All records are stored in a top-level vault folder named `Trip Ledger/` by default. Each new trip gets a folder based on its name. If the plain folder name is occupied, a short unique ID is appended. A previously created suffixed folder alone does not reserve the plain name. Each trip has a `trip.md` with its name and currency, and a `dates/YYYY-MM-DD.md` file for each recorded date. The ledger folder has a `categories.md` for custom categories. Expenses are stored in the day file's frontmatter; you can write notes in its body, which the plugin preserves.

Each trip uses one currency. You cannot change it after the first expense, even if you later delete every expense. The plugin does not fetch exchange rates, convert currencies, or combine totals across trips.

The plugin makes no network requests and collects no usage analytics. It reads and edits managed files in the current ledger folder. To find existing ledgers, it checks top-level vault folders and their immediate trip folders, reading candidate `trip.md` and `categories.md` files. The configured ledger folder and selected trip ID are stored in the plugin settings.

## Development and local installation

Use Node.js 18 or later and npm:

```bash
npm install
npm test
npm run build
npm run lint
```

Place the built `main.js`, `manifest.json`, and `styles.css` in `.obsidian/plugins/trip-ledger/` inside your vault. Enable **Trip Ledger** in **Settings → Community plugins**. If you develop inside that plugin folder, reload Obsidian after building.

`main.js` and `node_modules/` are generated files and are not committed to Git.

## License

Trip Ledger is distributed under the Zero-Clause BSD (0BSD) license. See [LICENSE](LICENSE).
