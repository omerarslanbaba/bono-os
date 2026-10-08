# BONO OS Web Desktop (WebView2 preview)

This is a **new**, isolated Windows WPF/WebView2 shell for the existing, unchanged BONO OS web application. It is **not** the manually reimplemented `desktop/BonoNative` interface.

- Opens `http://127.0.0.1:47831/` in a dedicated desktop application window.
- Uses `web/index.html`, `web/styles.css`, `web/styles-active.css` and the existing `web/js` logic served by the local BONO Core.
- Does not start/restart Core in preview, install browser extensions, change session state, call download/sync POST endpoints, or write archive/database files.
- Requires the current BONO Core to be running and Microsoft Edge WebView2 Runtime installed.
- Uses isolated WebView2 browser profile in `%LOCALAPPDATA%\BONO OS Web Desktop\WebView2Profile`.
- Browser profile is distinct from Chrome; UYAP login/extension remain in Chrome.
- This first preview is **not a standalone distribution of the Node.js Core**. Full installer/updater must separately package/manage Core after safety review.
- Links that try to open a separate window are blocked unless same origin. Review external attachment links and file-open behaviors before production use.
- No merge to `main`, no replacement of production EXE without explicit approval.

Build: `dotnet publish desktop/BonoWebDesktop/BonoWebDesktop.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true`.
