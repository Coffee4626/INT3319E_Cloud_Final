from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from app.domain import TrainingRequest


class MLTask(ABC):
    """Strategy contract shared by submission, training, and inference."""

    @abstractmethod
    def validate_training(self, request: TrainingRequest) -> None:
        """Reject invalid task input before writing to AWS."""

    def validate_prediction(self, payload: dict) -> list[dict]:
        rows = payload.get("rows")
        if (not isinstance(rows, list) or not 1 <= len(rows) <= 100
                or not all(isinstance(row, dict) for row in rows)):
            raise ValueError("rows must contain 1–100 JSON objects")
        return rows

    @abstractmethod
    def train(self, dataset: Path, model_dir: Path, job: dict) -> None:
        """Write a self-contained model directory."""

    @abstractmethod
    def load(self, model_dir: Path) -> Any:
        """Load an artifact produced by this strategy."""

    @abstractmethod
    def predict(self, model: Any, rows: list[dict]) -> dict:
        """Return a JSON-serializable prediction response."""
