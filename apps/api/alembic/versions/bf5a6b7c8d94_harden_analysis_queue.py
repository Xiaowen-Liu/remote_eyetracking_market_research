"""harden analysis queue

Revision ID: bf5a6b7c8d94
Revises: ae4f5a6b7c83
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "bf5a6b7c8d94"
down_revision: Union[str, None] = "ae4f5a6b7c83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("analysis_jobs", sa.Column("worker_attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("analysis_jobs", sa.Column("available_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False))
    op.add_column("analysis_jobs", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("analysis_jobs", sa.Column("dead_lettered_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_analysis_jobs_available_at", "analysis_jobs", ["available_at"])
    op.create_index("ix_analysis_jobs_lease_expires_at", "analysis_jobs", ["lease_expires_at"])
    op.create_index("ix_analysis_jobs_dead_lettered_at", "analysis_jobs", ["dead_lettered_at"])


def downgrade() -> None:
    op.drop_index("ix_analysis_jobs_dead_lettered_at", table_name="analysis_jobs")
    op.drop_index("ix_analysis_jobs_lease_expires_at", table_name="analysis_jobs")
    op.drop_index("ix_analysis_jobs_available_at", table_name="analysis_jobs")
    op.drop_column("analysis_jobs", "dead_lettered_at")
    op.drop_column("analysis_jobs", "lease_expires_at")
    op.drop_column("analysis_jobs", "available_at")
    op.drop_column("analysis_jobs", "worker_attempts")
