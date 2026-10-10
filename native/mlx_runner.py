#!/usr/bin/env python3
import base64
import json
import multiprocessing
import sys
import traceback

import mlx.core as mx
import numpy as np

mx.set_default_device(mx.gpu)
sys.stdout.reconfigure(line_buffering=True)


def respond(request_id, result=None, error=None):
    payload = {"id": request_id}
    if error is not None:
        payload["error"] = error
    else:
        payload["result"] = result
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main():
    import mlx_whisper
    from mlx_whisper.transcribe import ModelHolder

    state = {"model_path": None}
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            request_id = request["id"]
            command = request["command"]
            if command == "prepare":
                state["model_path"] = request["modelPath"]
                ModelHolder.get_model(state["model_path"], mx.float16)
                respond(request_id, {"backend": "Apple MLX", "device": str(mx.default_device())})
            elif command == "transcribe":
                if state["model_path"] is None:
                    raise RuntimeError("MLX model is not prepared")
                audio_bytes = base64.b64decode(request["audio"])
                samples = np.frombuffer(audio_bytes, dtype=np.float32).copy()
                language = request.get("language")
                result = mlx_whisper.transcribe(
                    samples,
                    path_or_hf_repo=state["model_path"],
                    language=language,
                    task="transcribe",
                    temperature=0.0,
                    condition_on_previous_text=False,
                    word_timestamps=False,
                    verbose=None,
                )
                respond(request_id, {"text": result["text"], "language": result["language"]})
            elif command == "dispose":
                respond(request_id, True)
                return
            else:
                raise ValueError(f"Unknown command: {command}")
        except Exception as error:
            request_id = request.get("id") if "request" in locals() else None
            traceback.print_exc(file=sys.stderr)
            respond(request_id, error=str(error))


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()