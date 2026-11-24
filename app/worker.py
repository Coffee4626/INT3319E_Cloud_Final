import logging
import time

from app import runtime


def process(job_id):
    return runtime.training_service().process(job_id)


def main():
    logging.basicConfig(level=logging.INFO)
    queue, service = runtime.queue(), runtime.training_service()
    while True:
        try:
            for message in queue.receive():
                if service.process(message.job_id):
                    queue.acknowledge(message)
        except Exception:
            logging.exception("Worker polling failed; retrying")
            time.sleep(5)


if __name__ == "__main__":
    main()
