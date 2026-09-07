"""add editable study drafts

Revision ID: b8d7e3a92410
Revises: 60c5c5f19d16
Create Date: 2026-09-05
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "b8d7e3a92410"
down_revision: Union[str, None] = "60c5c5f19d16"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("study_versions") as batch_op:
        batch_op.add_column(
            sa.Column("source_revision", sa.Integer(), server_default="1", nullable=False)
        )
        batch_op.alter_column("published_by", existing_type=sa.Uuid(), nullable=True)
        batch_op.alter_column(
            "published_at", existing_type=sa.DateTime(timezone=True), nullable=True
        )


def downgrade() -> None:
    op.execute("DELETE FROM study_versions WHERE version_number = 0")
    with op.batch_alter_table("study_versions") as batch_op:
        batch_op.alter_column(
            "published_at", existing_type=sa.DateTime(timezone=True), nullable=False
        )
        batch_op.alter_column("published_by", existing_type=sa.Uuid(), nullable=False)
        batch_op.drop_column("source_revision")
