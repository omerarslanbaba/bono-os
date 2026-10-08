# BONO OS — Native UI parity contract (Web is source of truth)

## Canonical references
- **Shell/navigation/search:** `web/js/ui.js` and `web/styles-active.css` (also base `web/styles.css`).
- **Today:** `web/js/views/active/today.js`.
- **UYAP cases / filters / detail:** `web/js/views/active/uyap.js` (Chat-UYAP owns functional detail/control logic).
- **Hearing calendar:** `web/js/views/active/hearings.js`.
- **Powers:** `web/js/views/active/powers.js`.
- **System:** `web/js/views/active/system.js`.

**No freeform new design.** Match layout hierarchy, spacing, font scale, component proportions, density, labels, color tokens, interaction states and navigation of the canonical web UI. Existing generic WPF cards/tables do not satisfy parity.

## Verifiable components
| Web behavior | Native requirement |
|---|---|
| Sidebar Bugün, Dosyalarım, Duruşmalar, Vekâletler, Sistem | Same visible navigation and active-state hierarchy; internal UYAP screens accessible without losing existing functionality |
| Topbar global search + sync state | Actual search affordance and state, no blank unlabeled textbox |
| Today KPIs | **Bugünkü duruşma / 7 gün içindeki duruşma / 7 gün içindeki süre / Bugünkü açık iş**, backed by `/api/morning-brief` + hearings, not UYAP download queue |
| Daily brief | Compact `Günlük Özet` list |
| Upcoming hearings | Compact clickable list, separate from system/worker status |
| UYAP case search | Yargı türü, birim, mahkeme, yıl/numara, durum, text query and category chips; dense case list |
| Hearing calendar | 3 month event calendar, linked detail |
| Powers | List + client metadata/detail as implemented on web |
| States | Loading/empty/error, consistent dark popup/dropdown, Turkish display values, no cut-off headers |
| File details | Clear information hierarchy with back link, client details, linked cases, deadlines/tasks and real evidence/documents when supplied by APIs |

## Visual source values (not arbitrary additions)
- `--bono-cyan: #19aee6`
- Page background `#121317`; sidebar `#17181c`; panels `#181a1e`; panel borders `#30343a`.
- Web shell topbar height **64px**; content padding **18px 22px 30px**.
- Web hero title **26px**; dense tables and compact cards.
- Preserve original brand/logo. Avoid duplicate page headings, duplicate refresh actions, native white comboboxes, oversized empty regions and generic admin templates.

## Engineering / coordination
- Chat-UI owns visual components, shell and office screens on `feature/native-ui`.
- Chat-UYAP owns per-file UYAP detail, stale tokens, query/download lanes on `feature/uyap-core`.
- Chat-Archive owns canonical archive and format safety on `feature/archive-engine`.
- Chat-Sync owns the three-way MainWindow integration recipe.
- Respect Issue #3 before reconciling `MainWindow.xaml/.cs`; preserve local UYAP detail snapshot commit `3ad9864` and backend pause commit `5ecf353`.
- PR #4 **DRAFT / no merge**, no live EXE replacement until screenshots and behavior tests show real parity.
- GitHub Actions for routine builds; Desktop Commander only for explicitly needed local deployment. Protect local sessions, queues, database and files.
- No database metadata migration (asset 46) unless user separately explicitly approves it.

## First visual milestone
1. Implement a reusable WPF theme, including consistent buttons, popup/select, cards, field labels and compact typography.
2. Rebuild **Today** to use original web KPIs + morning brief + upcoming hearings, not generic queue-card.
3. Rebuild **Dosyalarım** without duplicate titles/refresh and with original filtering density.
4. Produce captured screenshots side by side with the web reference; only then declare the visual milestone done.
