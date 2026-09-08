"""add retrievable participant links

Revision ID: c41a80c9d27e
Revises: b8d7e3a92410
Create Date: 2026-09-07
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "c41a80c9d27e"
down_revision: Union[str, None] = "b8d7e3a92410"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("participant_links") as batch_op:
        batch_op.add_column(sa.Column("public_code", sa.String(length=64), nullable=True))
        batch_op.create_index("ix_participant_links_public_code", ["public_code"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("participant_links") as batch_op:
        batch_op.drop_index("ix_participant_links_public_code")
        batch_op.drop_column("public_code")
