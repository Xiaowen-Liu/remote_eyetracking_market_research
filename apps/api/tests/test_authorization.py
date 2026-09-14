import uuid

from test_studies import study_payload

from webgaze_api.auth import hash_password
from webgaze_api.models import Researcher


def researcher_session(client, db_session, email: str) -> tuple[Researcher, dict[str, str]]:
    password = "correct-horse-battery"
    researcher = Researcher(
        id=uuid.uuid4(),
        email=email,
        display_name=email.split("@", 1)[0].title(),
        password_hash=hash_password(password),
    )
    db_session.add(researcher)
    db_session.commit()
    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200
    return researcher, {
        "Authorization": f"Bearer {login.json()['access_token']}"
    }


def project_team(client, db_session):
    owner, owner_headers = researcher_session(client, db_session, "owner@example.com")
    editor, editor_headers = researcher_session(client, db_session, "editor@example.com")
    viewer, viewer_headers = researcher_session(client, db_session, "viewer@example.com")
    outsider, outsider_headers = researcher_session(client, db_session, "outsider@example.com")
    created = client.post(
        "/api/v1/projects",
        headers=owner_headers,
        json={"name": "Role-isolated research"},
    )
    assert created.status_code == 201
    project_id = created.json()["id"]
    memberships = {}
    for researcher, role in ((editor, "editor"), (viewer, "viewer")):
        response = client.post(
            f"/api/v1/projects/{project_id}/members",
            headers=owner_headers,
            json={"email": researcher.email, "role": role},
        )
        assert response.status_code == 201
        memberships[role] = response.json()
    return {
        "project_id": project_id,
        "owner": (owner, owner_headers),
        "editor": (editor, editor_headers),
        "viewer": (viewer, viewer_headers),
        "outsider": (outsider, outsider_headers),
        "memberships": memberships,
    }


def test_project_roles_enforce_read_edit_and_admin_boundaries(client, db_session):
    team = project_team(client, db_session)
    project_id = team["project_id"]
    owner_headers = team["owner"][1]
    editor_headers = team["editor"][1]
    viewer_headers = team["viewer"][1]
    outsider_headers = team["outsider"][1]

    assert client.get(
        f"/api/v1/projects/{project_id}/access", headers=owner_headers
    ).json() == {
        "project_id": project_id,
        "role": "owner",
        "can_edit": True,
        "can_manage_members": True,
        "can_delete": True,
    }
    assert client.get(
        f"/api/v1/projects/{project_id}/access", headers=editor_headers
    ).json()["can_edit"] is True
    viewer_access = client.get(
        f"/api/v1/projects/{project_id}/access", headers=viewer_headers
    ).json()
    assert viewer_access["role"] == "viewer"
    assert viewer_access["can_edit"] is False
    assert viewer_access["can_manage_members"] is False
    assert client.get(
        f"/api/v1/projects/{project_id}/access", headers=outsider_headers
    ).status_code == 404

    assert client.get(f"/api/v1/projects/{project_id}", headers=viewer_headers).status_code == 200
    assert client.patch(
        f"/api/v1/projects/{project_id}",
        headers=editor_headers,
        json={"name": "Editor-updated research"},
    ).status_code == 200

    viewer_write = client.patch(
        f"/api/v1/projects/{project_id}",
        headers=viewer_headers,
        json={"name": "Viewer overwrite"},
    )
    assert viewer_write.status_code == 403
    assert viewer_write.json()["error"]["code"] == "PROJECT_ROLE_REQUIRED"

    editor_admin = client.get(
        f"/api/v1/projects/{project_id}/members", headers=editor_headers
    )
    assert editor_admin.status_code == 403
    assert client.delete(
        f"/api/v1/projects/{project_id}", headers=editor_headers
    ).status_code == 403

    hidden = client.get(
        f"/api/v1/projects/{project_id}", headers=outsider_headers
    )
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "PROJECT_NOT_FOUND"
    assert client.get("/api/v1/projects", headers=outsider_headers).json()["total"] == 0

    members = client.get(
        f"/api/v1/projects/{project_id}/members", headers=owner_headers
    )
    assert members.status_code == 200
    assert {item["role"] for item in members.json()["items"]} == {
        "owner",
        "editor",
        "viewer",
    }
    audit = client.get(
        f"/api/v1/projects/{project_id}/audit-events", headers=owner_headers
    )
    assert audit.status_code == 200
    assert {
        event["action"] for event in audit.json()["items"]
    } >= {"project.created", "project.member_added", "project.updated"}


def test_study_and_analysis_permissions_follow_project_role(client, db_session):
    team = project_team(client, db_session)
    project_id = team["project_id"]
    editor_headers = team["editor"][1]
    viewer_headers = team["viewer"][1]
    outsider_headers = team["outsider"][1]

    created = client.post(
        f"/api/v1/projects/{project_id}/studies",
        headers=editor_headers,
        json=study_payload(),
    )
    assert created.status_code == 201
    study_id = created.json()["id"]
    assert client.get(
        f"/api/v1/studies/{study_id}/draft", headers=viewer_headers
    ).status_code == 200
    assert client.put(
        f"/api/v1/studies/{study_id}/draft",
        headers=viewer_headers,
        json=study_payload("Viewer write"),
    ).status_code == 403
    assert client.get(
        f"/api/v1/studies/{study_id}/draft", headers=outsider_headers
    ).status_code == 404

    published = client.post(
        f"/api/v1/studies/{study_id}/publish",
        headers={**editor_headers, "Idempotency-Key": "editor-publish"},
    )
    assert published.status_code == 200
    assert client.post(
        f"/api/v1/studies/{study_id}/synthetic-results",
        headers=viewer_headers,
    ).status_code == 403
    synthetic = client.post(
        f"/api/v1/studies/{study_id}/synthetic-results",
        headers=editor_headers,
    )
    assert synthetic.status_code == 200

    jobs = client.get(
        f"/api/v1/studies/{study_id}/analysis-jobs", headers=viewer_headers
    )
    assert jobs.status_code == 200
    job_id = jobs.json()["items"][0]["id"]
    assert client.get(
        f"/api/v1/analysis-jobs/{job_id}/result", headers=viewer_headers
    ).status_code == 200
    assert client.get(
        f"/api/v1/analysis-jobs/{job_id}/export?format=json",
        headers=viewer_headers,
    ).status_code == 200
    assert client.post(
        f"/api/v1/analysis-jobs/{job_id}/run", headers=viewer_headers
    ).status_code == 403
    assert client.get(
        f"/api/v1/analysis-jobs/{job_id}", headers=outsider_headers
    ).status_code == 404


def test_owner_can_change_and_remove_a_collaborator(client, db_session):
    team = project_team(client, db_session)
    project_id = team["project_id"]
    owner_headers = team["owner"][1]
    viewer_headers = team["viewer"][1]
    membership_id = team["memberships"]["viewer"]["id"]

    promoted = client.patch(
        f"/api/v1/projects/{project_id}/members/{membership_id}",
        headers=owner_headers,
        json={"role": "editor"},
    )
    assert promoted.status_code == 200
    assert promoted.json()["role"] == "editor"
    assert client.patch(
        f"/api/v1/projects/{project_id}",
        headers=viewer_headers,
        json={"name": "Promoted collaborator edit"},
    ).status_code == 200

    removed = client.delete(
        f"/api/v1/projects/{project_id}/members/{membership_id}",
        headers=owner_headers,
    )
    assert removed.status_code == 204
    assert client.get(
        f"/api/v1/projects/{project_id}", headers=viewer_headers
    ).status_code == 404
