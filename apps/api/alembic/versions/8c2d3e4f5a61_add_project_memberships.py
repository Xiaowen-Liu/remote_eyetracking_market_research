"""add project memberships

Revision ID: 8c2d3e4f5a61
Revises: 7b1c2d3e4f50
"""

from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "8c2d3e4f5a61"
down_revision: Union[str, None] = "7b1c2d3e4f50"
branch_labels: Union[str, list[str], None] = None
depends_on: Union[str, list[str], None] = None


def upgrade() -> None:
    op.create_table(
        "project_memberships",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("researcher_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=6), nullable=False),
        sa.Column("invited_by", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["project_id"], ["research_projects.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["researcher_id"], ["researchers.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "role IN ('owner', 'editor', 'viewer')", name="project_role"
        ),
        sa.UniqueConstraint("project_id", "researcher_id"),
    )
    op.create_index(
        op.f("ix_project_memberships_project_id"),
        "project_memberships",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_project_memberships_researcher_id"),
        "project_memberships",
        ["researcher_id"],
        unique=False,
    )
    with op.batch_alter_table("audit_events") as batch_op:
        batch_op.add_column(sa.Column("project_id", sa.Uuid(), nullable=True))
        batch_op.create_index(
            op.f("ix_audit_events_project_id"), ["project_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("audit_events") as batch_op:
        batch_op.drop_index(op.f("ix_audit_events_project_id"))
        batch_op.drop_column("project_id")
    op.drop_index(
        op.f("ix_project_memberships_researcher_id"),
        table_name="project_memberships",
    )
    op.drop_index(
        op.f("ix_project_memberships_project_id"),
        table_name="project_memberships",
    )
    op.drop_table("project_memberships")
