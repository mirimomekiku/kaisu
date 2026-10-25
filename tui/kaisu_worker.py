"""Private subprocess entrypoint; stdout is a JSON event protocol."""
import json
import sys
import yt_dlp


def emit(event):
    print(json.dumps(event), flush=True)


def run():
    request = json.loads(sys.stdin.readline())
    operation, options = request["operation"], request["options"]
    if operation == "download":
        def progress(data):
            info = data.get("info_dict", {})
            emit({"kind": "progress", "data": {**{key: data.get(key) for key in ("status", "total_bytes", "total_bytes_estimate", "downloaded_bytes", "speed", "eta")}, "info_dict": {"format_id": info.get("format_id")}}})
        options["progress_hooks"] = [progress]
        options["postprocessor_hooks"] = [lambda data: emit({"kind": "postprocess", "data": {"status": data.get("status")}})]
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(request["payload"], download=operation == "download")
        if operation == "download":
            downloads = (info or {}).get("requested_downloads") or []
            path = (info or {}).get("filepath") or (downloads[0].get("filepath") if downloads else None)
            emit({"kind": "result", "data": path or "(unknown location)"})
        else:
            emit({"kind": "result", "data": downloader.sanitize_info(info)})


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        emit({"kind": "error", "message": str(error)})
        sys.exit(1)
