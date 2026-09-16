"""Run bounded participant-data retention cleanup for all projects."""

from __future__ import annotations

import argparse

from sqlalchemy import distinct, select

from webgaze_api.database import SessionLocal
from webgaze_api.models import AuditEvent, ResearchProject
from webgaze_api.retention import run_project_retention


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report without deleting")
    parser.add_argument("--limit-per-project", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.limit_per_project <= 1000:
        parser.error("--limit-per-project must be between 1 and 1000")

    deleted_sessions = 0
    with SessionLocal() as db:
        project_ids = list(db.scalars(select(distinct(ResearchProject.id))))
        for project_id in project_ids:
            evaluated_at, candidates, counts = run_project_retention(
                db,
                project_id,
                dry_run=args.dry_run,
                limit=args.limit_per_project,
            )
            print(
                f"project={project_id} candidates={len(candidates)} "
                f"deleted={0 if args.dry_run else len(candidates)}"
            )
            if not args.dry_run and candidates:
                db.add(
                    AuditEvent(
                        actor_id=None,
                        project_id=project_id,
                        action="project.retention_executed",
                        resource_type="project",
                        resource_id=project_id,
                        occurred_at=evaluated_at,
                        event_metadata={
                            "source": "scheduled_job",
                            "deleted_sessions": len(candidates),
                            "deleted_counts": counts,
                        },
                    )
                )
                deleted_sessions += len(candidates)
        if not args.dry_run:
            db.commit()
    print(f"complete dry_run={args.dry_run} deleted_sessions={deleted_sessions}")


if __name__ == "__main__":
    main()
