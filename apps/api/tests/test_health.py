def test_health_returns_service_identity_and_request_id(client):
    response = client.get("/healthz", headers={"X-Request-ID": "test-request"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "webgaze-api"}
    assert response.headers["X-Request-ID"] == "test-request"
