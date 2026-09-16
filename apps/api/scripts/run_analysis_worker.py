"""Process queued analysis jobs with bounded retry and dead-letter handling."""

import argparse

from webgaze_api.analysis_worker import claim_analysis_job, process_claimed_job
from webgaze_api.database import SessionLocal


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-jobs", type=int, default=25)
    args = parser.parse_args()
    if not 1 <= args.max_jobs <= 1000:
        parser.error("--max-jobs must be between 1 and 1000")

    processed = failed = 0
    with SessionLocal() as db:
        while processed < args.max_jobs:
            job = claim_analysis_job(db)
            if not job:
                break
            succeeded = process_claimed_job(db, job)
            processed += 1
            failed += int(not succeeded)
            print(
                f"job={job.id} attempt={job.worker_attempts} "
                f"status={job.status.value}"
            )
    print(f"complete processed={processed} failed={failed}")


if __name__ == "__main__":
    main()
