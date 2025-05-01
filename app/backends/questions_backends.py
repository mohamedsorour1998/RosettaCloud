"""
Concrete back‑end factories for questions_service.

• Momento  – fully implemented.
"""

import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from typing import Any, Dict, List, Tuple

import aioboto3

from app.services import cache_events_service as cache  

class QuestionBackend:
    def __init__(self) -> None:
        self.bucket_name   = os.getenv("S3_BUCKET_NAME", "rosettacloud-shared-interactive-labs")
        self.namespace     = os.getenv("LAB_K8S_NAMESPACE", "openedx")

        self._shell_files: Dict[Tuple[str, str], List[str]]        = {}
        self._shell_files_by_number: Dict[Tuple[str, str], Dict[int, str]] = {}

        # Cache settings
        self.cache_name = "question_backend"
        self.ttl_secs   = 3600

    async def get_questions(self, module_uuid: str,
                             lesson_uuid: str) -> Dict[str, Any]:
        """Return question metadata and total count – results are cached."""
        shell_files = await self._fetch_shells(module_uuid, lesson_uuid)

        questions, shell_by_num = self._convert_shells_to_questions(shell_files)

        key = (module_uuid, lesson_uuid)
        self._shell_files[key]            = shell_files
        self._shell_files_by_number[key]  = shell_by_num

        await asyncio.gather(*[
            cache.set(
                self.cache_name,
                f"shell:{module_uuid}:{lesson_uuid}:{q_no}",
                content,
                self.ttl_secs,
            )
            for q_no, content in shell_by_num.items()
        ])

        return {"questions": questions, "total_count": len(questions)}

    async def execute_question_by_number(
        self,
        pod_name: str,
        module_uuid: str,
        lesson_uuid: str,
        question_number: int,
    ) -> bool:
        """Run the “-q” section of one question inside the pod."""
        shell = await self._get_shell_by_number(module_uuid, lesson_uuid,
                                                question_number)
        if not shell:
            logging.error("Question #%s not found", question_number)
            return False
        return await self._exec_script_in_pod(pod_name, shell, part="q")

    async def execute_check_by_number(
        self,
        pod_name: str,
        module_uuid: str,
        lesson_uuid: str,
        question_number: int,
    ) -> bool:
        """Run the “-c” section of one question inside the pod."""
        shell = await self._get_shell_by_number(module_uuid, lesson_uuid,
                                                question_number)
        if not shell:
            logging.error("Question #%s not found", question_number)
            return False
        return await self._exec_script_in_pod(pod_name, shell, part="c")

    async def _fetch_shells(self, module_uuid: str,
                            lesson_uuid: str) -> List[str]:
        """S3 → Momento cached list of shell files (raw text)."""
        cache_key = f"shells:{module_uuid}:{lesson_uuid}"
        cached    = await cache.get(self.cache_name, cache_key)
        if cached is not None:
            try:
                return json.loads(cached)
            except Exception:
                logging.warning("Corrupt cache entry %s – refetching", cache_key)

        try:
            async with aioboto3.Session().client("s3") as s3:
                prefix = f"{module_uuid}/{lesson_uuid}/"
                resp   = await s3.list_objects_v2(
                    Bucket=self.bucket_name, Prefix=prefix
                )
                keys   = [
                    o["Key"] for o in resp.get("Contents", [])
                    if o["Key"].endswith(".sh")
                ]

                shells: List[str] = []
                for key in keys:
                    obj  = await s3.get_object(Bucket=self.bucket_name, Key=key)
                    body = await obj["Body"].read()
                    shells.append(body.decode())

            await cache.set(self.cache_name, cache_key,
                            json.dumps(shells), self.ttl_secs)
            return shells

        except Exception as exc:
            logging.error("Fetch shells failed: %s", exc)
            return []

    def _convert_shells_to_questions(
        self, shell_files: List[str]
    ) -> Tuple[List[Dict[str, Any]], Dict[int, str]]:

        questions: List[Dict[str, Any]] = []
        by_number: Dict[int, str]       = {}

        for shell in shell_files:
            (q_txt, q_type, diff,
             choices, corr, q_no) = self._extract(shell)

            q_info: Dict[str, Any] = {
                "question_number":     q_no,
                "question":            q_txt,
                "question_type":       q_type,
                "question_difficulty": diff,
            }
            if q_type == "MCQ":
                q_info["answer_choices"] = choices
                q_info["correct_answer"] = corr

            questions.append(q_info)
            by_number[q_no] = shell

        questions.sort(key=lambda x: x["question_number"])
        return questions, by_number

    async def _get_shell_by_number(self, module_uuid: str, lesson_uuid: str,
                                   q_no: int) -> str | None:
        """Try Momento → local cache → S3."""
        cache_key = f"shell:{module_uuid}:{lesson_uuid}:{q_no}"
        cached    = await cache.get(self.cache_name, cache_key)
        if cached:
            return cached.decode() if isinstance(cached, bytes) else cached

        # fall back to local memory / S3
        key = (module_uuid, lesson_uuid)
        if key not in self._shell_files_by_number:
            shells = await self._fetch_shells(module_uuid, lesson_uuid)
            _, by_num = self._convert_shells_to_questions(shells)
            self._shell_files_by_number[key] = by_num
        return self._shell_files_by_number[key].get(q_no)

    async def _exec_script_in_pod(self, pod: str, shell: str,
                                  part: str) -> bool:
        """Extract -q or -c, copy to pod, execute, return success."""
        extractor = self._extract_question_script if part == "q" \
                    else self._extract_check_script
        script_body = extractor(shell)
        if not script_body:
            logging.error("No %s script block found", part)
            return False

        # write temp file
        with tempfile.NamedTemporaryFile("w+", suffix=".sh", delete=False) as tf:
            tf.write("#!/bin/bash\n")
            tf.write(script_body)
            tf.write("\nexit $?\n")
            path = tf.name
        os.chmod(path, 0o755)
        try:
            # kubectl cp
            dst = f"{pod}:/tmp/{part}_script.sh"
            cp  = subprocess.run(
                ["kubectl", "cp", path, dst, "-n", self.namespace],
                capture_output=True, text=True
            )
            if cp.returncode:
                logging.error("kubectl cp failed: %s", cp.stderr)
                return False

            # kubectl exec
            exec_cmd = (
                "chmod +x /tmp/{f} && /tmp/{f}".format(f=f"{part}_script.sh")
            )
            ex = subprocess.run(
                ["kubectl", "exec", pod, "-n", self.namespace,
                 "--", "bash", "-c", exec_cmd],
                capture_output=True, text=True
            )
            return ex.returncode == 0

        finally:
            os.unlink(path)

# This is a helper class to extract question data from the shell script
# It uses regular expressions to find the relevant information
    def _extract(self, shell: str
                 ) -> Tuple[str, str, str, List[str], str, int]:
        return (
            self._q_text(shell),
            self._q_type(shell),
            self._q_diff(shell),
            self._choices(shell),
            self._correct(shell),
            self._q_number(shell),
        )

    @staticmethod
    def _q_number(txt: str) -> int:
        m = re.search(r"#\s*Question\s+Number:\s*(\d+)", txt, re.I)
        return int(m.group(1)) if m else 999

    @staticmethod
    def _q_text(txt: str) -> str:
        m = re.search(r"#\s*Question:\s*(.*?)($|\n)", txt)
        return m.group(1).strip() if m else "Unknown Question"

    @staticmethod
    def _q_type(txt: str) -> str:
        m = re.search(r"#\s*Question\s+Type:\s*(MCQ|Check)", txt, re.I)
        return m.group(1) if m else "Check"

    @staticmethod
    def _q_diff(txt: str) -> str:
        m = re.search(r"#\s*Question\s+Difficulty:\s*(Easy|Medium|Hard)", txt,
                      re.I)
        return m.group(1).capitalize() if m else "Medium"

    @staticmethod
    def _choices(txt: str) -> List[str]:
        return [
            m.group(1).strip() for m in
            re.finditer(r"#\s*-\s*answer_\d+:\s*(.*?)($|\n)", txt)
        ]

    @staticmethod
    def _correct(txt: str) -> str:
        m = re.search(r"#\s*Correct answer:\s*(answer_\d+)", txt)
        if not m:
            return ""
        a_id = m.group(1)
        am   = re.search(r"#\s*-\s*" + re.escape(a_id) + r":\s*(.*?)($|\n)", txt)
        return am.group(1).strip() if am else ""
    
    @staticmethod
    def _extract_block(txt: str, flag: str) -> str:
        lines      = txt.splitlines()
        collecting = False
        depth      = 0
        body: list[str] = []
        for ln in lines:
            if not collecting:
                if f'"$1" == "{flag}"' in ln and "if" in ln:
                    collecting = True
                    depth = 1
                continue
            if re.search(r'\bif\b', ln):
                depth += 1
    
            if re.match(r'\s*fi\b', ln):
                depth -= 1
                if depth == 0:
                    break
                body.append(ln)
                continue
            body.append(ln)
    
        return "\n".join(body).strip()

    @staticmethod
    def _extract_question_script(txt: str) -> str:
        return QuestionBackend._extract_block(txt, "-q")

    @staticmethod
    def _extract_check_script(txt: str) -> str:
        return QuestionBackend._extract_block(txt, "-c")
