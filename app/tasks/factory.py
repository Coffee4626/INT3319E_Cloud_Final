from collections.abc import Callable

from app.tasks.base import MLTask


class TaskFactory:
    """Explicit registry: task input can never import arbitrary Python code."""

    def __init__(self):
        self._builders: dict[str, Callable[[], MLTask]] = {}

    def register(self, name: str, builder: Callable[[], MLTask]) -> None:
        if not isinstance(name, str) or not name or name in self._builders:
            raise ValueError(f"Invalid or duplicate task registration: {name}")
        self._builders[name] = builder

    def create(self, name: str) -> MLTask:
        if not isinstance(name, str) or name not in self._builders:
            raise ValueError(f"Unsupported task. Choose one of: {', '.join(self.names)}")
        return self._builders[name]()

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._builders))


def default_factory() -> TaskFactory:
    from app.tasks.tabular import AutoTabularTask, ClassificationTask, RegressionTask
    from app.tasks.vision import ImageClassificationTask, SegmentationTask

    from app.tasks.unsupervised import AnomalyTask, ClusteringTask
    from app.tasks.forecasting import ForecastingTask
    from app.tasks.tabular import TextClassificationTask

    factory = TaskFactory()
    factory.register("tabular", AutoTabularTask)
    factory.register("classification", ClassificationTask)
    factory.register("regression", RegressionTask)
    factory.register("image-classification", ImageClassificationTask)
    factory.register("segmentation", SegmentationTask)
    factory.register("anomaly-detection", AnomalyTask)
    factory.register("clustering", ClusteringTask)
    factory.register("text-classification", TextClassificationTask)
    factory.register("forecasting", ForecastingTask)
    return factory
