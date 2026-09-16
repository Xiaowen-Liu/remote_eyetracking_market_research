"""add retention tombstones

Revision ID: ae4f5a6b7c83
Revises: 9d3e4f5a6b72
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "ae4f5a6b7c83"
down_revision: Union[str, None] = "9d3e4f5a6b72"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "retention_tombstones",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("study_id", sa.Uuid(), nullable=False),
        sa.Column("study_version_id", sa.Uuid(), nullable=False),
        sa.Column("retention_expired_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_counts", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id"),
    )
    op.create_index("ix_retention_tombstones_session_id", "retention_tombstones", ["session_id"])
    op.create_index("ix_retention_tombstones_project_id", "retention_tombstones", ["project_id"])
    op.create_index("ix_retention_tombstones_study_id", "retention_tombstones", ["study_id"])


def downgrade() -> None:
    op.drop_index("ix_retention_tombstones_study_id", table_name="retention_tombstones")
    op.drop_index("ix_retention_tombstones_project_id", table_name="retention_tombstones")
    op.drop_index("ix_retention_tombstones_session_id", table_name="retention_tombstones")
    op.drop_table("retention_tombstones")
