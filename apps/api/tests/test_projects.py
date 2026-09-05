import uuid


def create_project(client, **overrides):
    payload = {
        "name": "Accessible checkout attention study",
        "research_question": "Where do users look before choosing a plan?",
        **overrides,
    }
    return client.post("/api/v1/projects", json=payload)


def test_project_crud(client):
    created = create_project(client)
    assert created.status_code == 201
    project = created.json()
    assert project["status"] == "active"

    listed = client.get("/api/v1/projects")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    assert listed.json()["items"][0]["id"] == project["id"]

    updated = client.patch(
        f"/api/v1/projects/{project['id']}",
        json={"name": "Revised attention study", "status": "archived"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Revised attention study"
    assert updated.json()["status"] == "archived"

    deleted = client.delete(f"/api/v1/projects/{project['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/projects/{project['id']}").status_code == 404


def test_owner_cannot_read_another_owners_project(client):
    owner_a = str(uuid.uuid4())
    owner_b = str(uuid.uuid4())
    created = client.post(
        "/api/v1/projects",
        headers={"X-Demo-Owner-ID": owner_a},
        json={"name": "Private project"},
    )
    project_id = created.json()["id"]

    response = client.get(f"/api/v1/projects/{project_id}", headers={"X-Demo-Owner-ID": owner_b})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PROJECT_NOT_FOUND"


def test_validation_error_has_stable_contract(client):
    response = create_project(client, name="")

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["field"] == "name"
    assert body["request_id"]


def test_invalid_demo_owner_has_stable_error(client):
    response = client.get("/api/v1/projects", headers={"X-Demo-Owner-ID": "invalid"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_OWNER_ID"
