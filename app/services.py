"""Application use cases. AWS SDK and AutoGluon stay behind injected contracts."""
import logging
import shutil
import tempfile
import time
import uuid
from pathlib import Path

from app.domain import ArtifactStore, ConflictError, JobQueue, JobRepository, NotFoundError, TrainingRequest
from app.tasks.factory import TaskFactory

logger = logging.getLogger(__name__)


class JobService:
    def __init__(self, repository: JobRepository, artifacts: ArtifactStore,
                 queue: JobQueue, tasks: TaskFactory):
        self.repository, self.artifacts, self.queue, self.tasks = repository, artifacts, queue, tasks

    def submit(self, payload: dict) -> dict:
        request = TrainingRequest.parse(payload)
        self.tasks.create(request.task).validate_training(request)
        job_id = uuid.uuid4().hex
        key = f"datasets/{job_id}.csv"
        self.artifacts.save_csv(key, request.csv)
        self.repository.create_job({
            "id": job_id, "status": "QUEUED", "dataset_key": key, "task": request.task,
            "target": request.target, "time_limit": request.time_limit, "created_at": int(time.time())})
        try:
            self.queue.enqueue(job_id)
        except Exception:
            self.repository.submission_failed(job_id)
            raise
        return {"job_id": job_id, "status": "QUEUED", "task": request.task}

    def get(self, job_id: str) -> dict:
        job = self.repository.get_job(job_id)
        if not job:
            raise NotFoundError("Job not found")
        return {key: value for key, value in job.items() if key not in ("lease_owner", "lease_until")}

    def deploy(self, job_id: str) -> dict:
        if not isinstance(job_id, str) or not job_id:
            raise ValueError("job_id must be a non-empty string")
        job = self.repository.get_job(job_id)
        if not job or job["status"] != "COMPLETED":
            raise ConflictError("Job must be COMPLETED before deploying")
        task = job.get("task", "tabular")  # Existing jobs remain deployable.
        self.tasks.create(task)
        deployment_id = uuid.uuid4().hex
        self.repository.create_deployment({"id": f"deploy#{deployment_id}", "job_id": job_id,
                                           "model_key": job["model_key"], "task": task})
        return {"deployment_id": deployment_id, "predict_path": f"/predict/{deployment_id}", "task": task}


class TrainingService:
    def __init__(self, repository: JobRepository, artifacts: ArtifactStore, tasks: TaskFactory):
        self.repository, self.artifacts, self.tasks = repository, artifacts, tasks

    def process(self, job_id: str) -> bool:
        """Return True only when this delivery can safely be acknowledged."""
        job = self.repository.get_job(job_id)
        if not job or job["status"] in ("COMPLETED", "FAILED"):
            return True
        owner = uuid.uuid4().hex
        if not self.repository.claim(job_id, owner, int(time.time())):
            return False
        try:
            task = self.tasks.create(job.get("task", "tabular"))
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                self.artifacts.download(job["dataset_key"], root / "data.csv")
                task.train(root / "data.csv", root / "model", job)
                # Isolate attempts: an expired worker cannot overwrite the winning artifact.
                key = f"models/{job_id}/{owner}.zip"
                self.artifacts.upload_model(key, root / "model")
        except Exception as exc:
            logger.exception("Training failed: %s", job_id)
            return self.repository.finish(job_id, owner, error=str(exc))
        return self.repository.finish(job_id, owner, model_key=key)


class ModelCache:
    """One model per warm process; both task and artifact identify the cache entry."""

    def __init__(self, artifacts: ArtifactStore, directory: Path):
        self.artifacts, self.directory = artifacts, directory
        self._key, self._model = None, None

    def get(self, task_name, key, task):
        identity = (task_name, key)
        if identity != self._key:
            self._key, self._model = None, None
            shutil.rmtree(self.directory, ignore_errors=True)
            self.directory.mkdir(parents=True)
            self.artifacts.extract_model(key, self.directory)
            model = task.load(self.directory)
            self._model, self._key = model, identity
        return self._model


class PredictionService:
    def __init__(self, repository: JobRepository, tasks: TaskFactory, cache: ModelCache):
        self.repository, self.tasks, self.cache = repository, tasks, cache

    def predict(self, deployment_id: str, payload: dict) -> dict:
        deployment = self.repository.get_deployment(deployment_id)
        if not deployment:
            raise NotFoundError("Deployment not found")
        task_name = deployment.get("task", "tabular")
        task = self.tasks.create(task_name)
        rows = task.validate_prediction(payload)
        model = self.cache.get(task_name, deployment["model_key"], task)
        return task.predict(model, rows)
