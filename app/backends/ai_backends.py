"""
Concrete AI back‑ends for *AIBus*.

• nova – Amazon Bedrock Nova via ConverseStream.
"""

from __future__ import annotations

import json
import logging
import os
from typing import AsyncGenerator, Optional

import aioboto3

# ───────────────────────── defaults ───────────────────────────────────────
_REGION      = os.getenv("AWS_REGION", "us-east-1")
_MODEL_ID    = os.getenv("NOVA_MODEL_ID", "amazon.nova-lite-v1:0")
_MAX_TOKENS  = int(os.getenv("NOVA_MAX_TOKENS", "512"))
_TEMPERATURE = float(os.getenv("NOVA_TEMPERATURE", "0.5"))
_TOP_P       = float(os.getenv("NOVA_TOP_P", "0.9"))
_DEFAULT_SYS = "You are a helpful assistant."

# ═════════════════════════ NOVA BACK‑END ══════════════════════════════════
def get_nova_backend():
    class NovaAI:
        _log = logging.getLogger("AIBus.nova")

        _session: Optional[aioboto3.Session] = None
        _client_cm = None
        _client    = None

        async def init(self):
            if self._client:
                return
            self._session = aioboto3.Session()
            self._client_cm = self._session.client(
                "bedrock-runtime", region_name=_REGION
            )
            self._client = await self._client_cm.__aenter__()
            self._log.info("Connected to Bedrock runtime (%s)", _REGION)

        async def close(self):
            if self._client_cm:
                await self._client_cm.__aexit__(None, None, None)
                self._client_cm = self._client = None

        async def chat(
            self,
            prompt: str,
            *,
            stream: bool = False,
            system_role: str | None = None,
            model_id: str | None = None,
            max_tokens: int | None = None,
            temperature: float | None = None,
            top_p: float | None = None,
        ) -> str | AsyncGenerator[str, None]:
            await self.init()

            sys_txt = system_role or _DEFAULT_SYS
            full_prompt = f"{sys_txt}\n\n{prompt}"

            messages = [{"role": "user", "content": [{"text": full_prompt}]}]

            cfg = {
                "maxTokens":   max_tokens  or _MAX_TOKENS,
                "temperature": temperature or _TEMPERATURE,
                "topP":        top_p       or _TOP_P,
            }
            model = model_id or _MODEL_ID

            # —— streaming ——
            if stream:
                resp = await self._client.converse_stream(
                    modelId=model,
                    messages=messages,
                    inferenceConfig=cfg,
                )

                async def _chunks() -> AsyncGenerator[str, None]:
                    async for chunk in resp["stream"]:
                        if "contentBlockDelta" in chunk:
                            yield chunk["contentBlockDelta"]["delta"]["text"]

                return _chunks()

            # —— non‑streaming ——
            raw = await self._client.invoke_model(
                body=json.dumps(
                    {"inputText": prompt, "textGenerationConfig": cfg}
                ),
                modelId=model,
            )
            return json.loads(raw["body"])["results"][0]["outputText"]

    return NovaAI()
