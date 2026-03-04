"""Lambda handler for RosettaCloud agent tools — AgentCore Gateway dispatch."""

import os
import re
import json
import boto3
import logging

logger = logging.getLogger(__name__)

# Configuration
USERS_TABLE = os.environ.get("USERS_TABLE_NAME", "rosettacloud-users")
S3_BUCKET   = os.environ.get("S3_BUCKET_NAME", "rosettacloud-shared-interactive-labs")
LANCEDB_URI = os.environ.get("LANCEDB_S3_URI", "s3://rosettacloud-shared-interactive-labs-vector")
TABLE_NAME  = os.environ.get("KNOWLEDGE_BASE_ID", "shell-scripts-knowledge-base")
REGION      = os.environ.get("AWS_REGION", "us-east-1")

# Lazy-initialized clients
_dynamodb = None
_s3 = None
_bedrock = None
_lance_table = None


def _get_dynamodb():
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb", region_name=REGION)
    return _dynamodb


def _get_s3():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", region_name=REGION)
    return _s3


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    return _bedrock


def _get_lance_table():
    global _lance_table
    if _lance_table is None:
        import lancedb
        db = lancedb.connect(LANCEDB_URI)
        _lance_table = db.open_table(TABLE_NAME)
    return _lance_table


def _embed_query(text: str) -> list[float]:
    client = _get_bedrock()
    response = client.invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        body=json.dumps({"inputText": text}),
    )
    return json.loads(response["body"].read())["embedding"]


def _parse_shell_headers(content: str) -> dict:
    """Parse question metadata from shell script header comments.

    Format:
        # Question Number: 1
        # Question: What command...
        # Question Type: MCQ|Check
        # Question Difficulty: Easy|Medium|Hard
        # Possible answers:
        # - answer_1: mkdir
        # - answer_2: ls
        # Correct answer: answer_1
    """
    meta = {}
    m = re.search(r"#\s*Question\s+Number:\s*(\d+)", content, re.I)
    if m:
        meta["question_number"] = int(m.group(1))

    m = re.search(r"#\s*Question:\s*(.*?)($|\n)", content)
    if m:
        meta["question_text"] = m.group(1).strip()

    m = re.search(r"#\s*Question\s+Type:\s*(MCQ|Check)", content, re.I)
    if m:
        meta["question_type"] = m.group(1)

    m = re.search(r"#\s*Question\s+Difficulty:\s*(Easy|Medium|Hard)", content, re.I)
    if m:
        meta["difficulty"] = m.group(1).capitalize()

    # Parse MCQ choices
    choices = []
    for cm in re.finditer(r"#\s*-\s*answer_\d+:\s*(.*?)($|\n)", content):
        choices.append(cm.group(1).strip())
    if choices:
        meta["choices"] = choices

    m = re.search(r"#\s*Correct answer:\s*(answer_\d+)", content)
    if m:
        a_id = m.group(1)
        am = re.search(r"#\s*-\s*" + re.escape(a_id) + r":\s*(.*?)($|\n)", content)
        if am:
            meta["correct_answer"] = am.group(1).strip()

    return meta


# ─── Knowledge Base (Tutor) ───


def search_knowledge_base(query: str) -> str:
    """Search the DevOps knowledge base for relevant content about Linux, Docker, and Kubernetes.

    Use this tool when you need to look up technical information to answer
    a student's question about DevOps topics.

    Args:
        query: The search query describing what information to find.

    Returns:
        JSON string with relevant document excerpts and metadata.
    """
    try:
        table = _get_lance_table()
        vector = _embed_query(query)
        results = table.search(vector).limit(3).to_list()
        docs = []
        for r in results:
            docs.append({
                "content": r.get("text", ""),
                "file_name": r.get("file_name", ""),
                "question_text": r.get("question_text", ""),
                "score": float(r.get("_distance", 0)),
            })
        return json.dumps(docs, indent=2)
    except Exception as e:
        logger.error("search_knowledge_base error: %s", e)
        return json.dumps({"error": str(e)})


# ─── User Progress (Grader + Planner) ───


def get_user_progress(user_id: str) -> str:
    """Get a student's learning progress across all modules and lessons.

    Args:
        user_id: The student's user ID.

    Returns:
        JSON with progress data per module/lesson/question.
    """
    try:
        table = _get_dynamodb().Table(USERS_TABLE)
        resp = table.get_item(Key={"user_id": user_id})
        item = resp.get("Item", {})
        return json.dumps({
            "user_id": user_id,
            "name": item.get("name", "Student"),
            "progress": item.get("progress", {}),
        }, indent=2, default=str)
    except Exception as e:
        logger.error("get_user_progress error: %s", e)
        return json.dumps({"error": str(e)})


def get_attempt_result(user_id: str, module_uuid: str, lesson_uuid: str, question_number: int) -> str:
    """Check if a student completed a specific question.

    Args:
        user_id: The student's user ID.
        module_uuid: Module identifier.
        lesson_uuid: Lesson identifier.
        question_number: Question number.

    Returns:
        JSON with completion status for this question.
    """
    try:
        table = _get_dynamodb().Table(USERS_TABLE)
        resp = table.get_item(Key={"user_id": user_id})
        item = resp.get("Item", {})
        progress = item.get("progress", {})
        completed = (
            progress
            .get(module_uuid, {})
            .get(lesson_uuid, {})
            .get(str(question_number), False)
        )
        return json.dumps({
            "question_number": question_number,
            "completed": completed,
            "module_uuid": module_uuid,
            "lesson_uuid": lesson_uuid,
        }, indent=2)
    except Exception as e:
        logger.error("get_attempt_result error: %s", e)
        return json.dumps({"error": str(e)})


# ─── Course Content (Grader + Planner) ───


def get_question_details(module_uuid: str, lesson_uuid: str, question_number: int) -> str:
    """Get details about a specific question: text, type, difficulty, correct answer.

    Args:
        module_uuid: Module identifier.
        lesson_uuid: Lesson identifier.
        question_number: Question number.

    Returns:
        JSON with question metadata parsed from shell script headers.
    """
    try:
        s3 = _get_s3()
        key = f"{module_uuid}/{lesson_uuid}/q{question_number}.sh"
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        content = obj["Body"].read().decode("utf-8")
        meta = _parse_shell_headers(content)
        return json.dumps(meta, indent=2)
    except Exception as e:
        logger.error("get_question_details error: %s", e)
        return json.dumps({"error": str(e)})


def list_available_modules() -> str:
    """List all available course modules and their lessons.

    Returns:
        JSON with module/lesson structure from S3.
    """
    try:
        s3 = _get_s3()
        resp = s3.list_objects_v2(Bucket=S3_BUCKET, Delimiter="/")
        modules = []
        for prefix in resp.get("CommonPrefixes", []):
            module_uuid = prefix["Prefix"].rstrip("/")
            lesson_resp = s3.list_objects_v2(
                Bucket=S3_BUCKET, Prefix=f"{module_uuid}/", Delimiter="/"
            )
            lessons = [
                lp["Prefix"].split("/")[1]
                for lp in lesson_resp.get("CommonPrefixes", [])
            ]
            modules.append({"module_uuid": module_uuid, "lessons": lessons})
        return json.dumps(modules, indent=2)
    except Exception as e:
        logger.error("list_available_modules error: %s", e)
        return json.dumps({"error": str(e)})


def get_question_metadata(module_uuid: str, lesson_uuid: str) -> str:
    """Get metadata for ALL questions in a lesson (difficulty, topics, types).

    Args:
        module_uuid: Module identifier.
        lesson_uuid: Lesson identifier.

    Returns:
        JSON with metadata for each question in the lesson.
    """
    try:
        s3 = _get_s3()
        prefix = f"{module_uuid}/{lesson_uuid}/"
        resp = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
        questions = []
        for obj in resp.get("Contents", []):
            filename = obj["Key"].split("/")[-1]
            match = re.match(r"q(\d+)\.sh", filename)
            if match:
                q_num = int(match.group(1))
                q_key = obj["Key"]
                q_obj = s3.get_object(Bucket=S3_BUCKET, Key=q_key)
                content = q_obj["Body"].read().decode("utf-8")
                meta = _parse_shell_headers(content)
                questions.append(meta)
        questions.sort(key=lambda x: x.get("question_number", 999))
        return json.dumps(questions, indent=2)
    except Exception as e:
        logger.error("get_question_metadata error: %s", e)
        return json.dumps({"error": str(e)})


# ─── Dispatch table ───

_TOOLS = {
    "search_knowledge_base":  lambda inp: search_knowledge_base(**inp),
    "get_user_progress":      lambda inp: get_user_progress(**inp),
    "get_attempt_result":     lambda inp: get_attempt_result(**inp),
    "get_question_details":   lambda inp: get_question_details(**inp),
    "list_available_modules": lambda inp: list_available_modules(**inp),
    "get_question_metadata":  lambda inp: get_question_metadata(**inp),
}


def lambda_handler(event, context):
    logger.info("Tool event: %s", json.dumps({k: v for k, v in event.items() if k != "toolInput"}))
    raw_name  = event.get("toolName", "")
    # Strip target prefix (e.g. "education-tools___search-knowledge-base" → "search-knowledge-base")
    tool_name = raw_name.split("___", 1)[-1] if "___" in raw_name else raw_name
    # Gateway uses hyphenated names; normalize to underscore for dispatch
    tool_name = tool_name.replace("-", "_")
    # Normalize hyphenated parameter keys to underscore (e.g. "user-id" → "user_id")
    raw_input  = event.get("toolInput", {})
    tool_input = {k.replace("-", "_"): v for k, v in raw_input.items()}
    handler_fn = _TOOLS.get(tool_name)
    if handler_fn is None:
        logger.error("Unknown tool: %s", tool_name)
        return json.dumps({"error": f"Unknown tool: {tool_name}"})
    try:
        return handler_fn(tool_input)
    except Exception as e:
        logger.error("Tool %s failed: %s", tool_name, e)
        return json.dumps({"error": str(e)})
