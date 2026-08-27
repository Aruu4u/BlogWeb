from main import app

async def handler(scope, receive, send):
    if scope["type"] == "http":
        path = scope.get("path", "")

        if path.startswith("/api"):
            scope = dict(scope)
            scope["path"] = path[4:] or "/"

            raw_path = scope.get("raw_path", b"")
            if raw_path.startswith(b"/api"):
                scope["raw_path"] = raw_path[4:] or b"/"

    await app(scope, receive, send)