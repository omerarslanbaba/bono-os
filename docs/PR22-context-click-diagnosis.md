# CBS observation stop diagnosis

The accepted live attempt used observation session `5df6f662-d08a-42de-b532-b07aff6dfb2a`. It was active with zero events before the one row action, then stopped with `context_click` and zero events. The visible target row and panel both showed Eskişehir CBS 2026/51832. The panel appeared within the same tab/URL; the first post-click view showed “Evrak Listesi Yükleniyor”, followed by collapsed “Son 20 Evrak / Tüm Evrak”. No additional expansion or request was attempted.

## What the evidence establishes

1. The old probe defaulted `stop()` to `context_click` for unrecognized clicks, row mismatch, disconnected anchors, changed rows/panels, keyboard input and expiry. This diagnostic conflation is a confirmed code defect.
2. The observation was armed before the click, but the old record cannot distinguish stopping during the capture click listener from stopping in the subsequent MutationObserver, nor prove whether a request had already been marked.
3. The observed Pencere Görünümü action opened an in-page panel in the same top-level tab, not an observed new window/tab. An internal iframe/request initiator was not independently established.
4. Previously cached categories are possible; the loading indicator does not prove a network request or a complete response.
5. No retained evidence proves whether the listing request preceded the click. The observer was armed after the preparation list query and only covers two existing document-list paths in its own frame.
6. A marked request could have been lost when the action anchor detached before response delivery: emit deliberately discards a response after disarm. This is reproduced in a synthetic test, not proven as this live attempt's exact branch.
7. A valid row repaint can therefore trigger a false-negative safety stop. No inference about document ownership follows from this.

## Isolated correction

Every old generic stop call now has an explicit reason. Stop status carries only bounded allowlisted integer counters: armed, trusted clicks, bound actions, matched document-list requests, synchronous requests, panel handoffs, responses received/emitted. No DOM text, URL parameters, IDs, contents or secrets are added to diagnostics. Unknown reason input is still rejected by the server.

If the clicked row control is removed after a request has already been observed synchronously inside the trusted target action, the existing action can transfer to the unique visible Evrak panel with the exact target number/unit title. Missing/ambiguous panel and asynchronous requests still stop. The Core's exact request dosyaId check, tab/frame/document/session checks, event correlation and metadata/download prohibition remain mandatory. The transfer never generates a request and never turns time proximity into causal evidence.

Tests cover row mismatch, detached anchor without panel, valid synchronous repaint handoff, asynchronous handoff rejection, keyboard/page reason separation, secret rejection in diagnostic counters, reverse concurrent responses, foreign tab/session, request identity conflicts and no import/download. The working normal query path is untouched.

## One future live acceptance

Requires separate approval for installing the revised observation files and one target-row opening. With the target result row already available, arm case 93, then click Pencere Görünümü once. Do not expand categories, refresh, or retry. Inspect explicit stop reason/counters and the paired evidence. If no synchronous target request exists or panel/identity cannot be verified, stop and report that boundary. A missing result list requires separate permission for preparation; it is not covered implicitly. Restore the normal runtime after the test. No live operation was performed for this isolated correction.
