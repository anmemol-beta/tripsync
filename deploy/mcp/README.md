# Tripsync — self-hosted MongoDB MCP server on Cloud Run

Deploys `mongodb-js/mongodb-mcp-server` as a private Cloud Run service that
Vertex AI Agent Builder reaches over HTTP/SSE.  Only the four MCP primitives
Tripsync needs (`find`, `insert-one`, `update-one`, `aggregate`) are exposed.

> **Prerequisites:** `gcloud` CLI authenticated, Docker, a GCP project with
> billing enabled, a MongoDB Atlas cluster (free M0 works for the demo).

---

## 1. Set variables

```bash
export PROJECT_ID=your-gcp-project-id      # GCP project
export REGION=asia-northeast3              # Cloud Run region (Seoul); change if needed
export REPO=tripsync                       # Artifact Registry repo name
export IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/$REPO/mcp
export MONGODB_URI="mongodb+srv://USER:PASS@cluster.example.mongodb.net/tripsync"
```

## 2. Create a service account

```bash
gcloud iam service-accounts create tripsync-mcp-sa \
  --display-name "Tripsync MCP server" \
  --project "$PROJECT_ID"
```

The service account needs no roles beyond the implicit Cloud Run runtime role.
It is used so we can grant invoker-only access to Agent Builder in §4.

## 3. Store the Atlas URI in Secret Manager

```bash
echo -n "$MONGODB_URI" | gcloud secrets create mongodb-uri \
  --data-file=- \
  --project "$PROJECT_ID"

# Grant the service account read access to the secret
gcloud secrets add-iam-policy-binding mongodb-uri \
  --member="serviceAccount:tripsync-mcp-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project "$PROJECT_ID"
```

## 4. Create Artifact Registry repo and build the image

```bash
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --project "$PROJECT_ID"

gcloud auth configure-docker "$REGION-docker.pkg.dev"

# Build from this directory
docker build -t "$IMAGE:latest" .
docker push "$IMAGE:latest"
```

## 5. Deploy to Cloud Run

Substitute the two `TODO(needs-user)` placeholders in `cloudrun.yaml` first:

```bash
sed -i \
  -e "s|PROJECT_ID|$PROJECT_ID|g" \
  -e "s|REGION|$REGION|g" \
  cloudrun.yaml

gcloud run services replace cloudrun.yaml \
  --region "$REGION" \
  --project "$PROJECT_ID"
```

The service is deployed without `--allow-unauthenticated`.

## 6. Grant Vertex AI Agent Builder invoker access

```bash
# Get the Vertex AI Agent Builder default service account for your project
AGENT_SA="service-$(gcloud projects describe $PROJECT_ID \
  --format='value(projectNumber)')@gcp-sa-aiplatform.iam.gserviceaccount.com"

gcloud run services add-iam-policy-binding tripsync-mcp \
  --member="serviceAccount:$AGENT_SA" \
  --role="roles/run.invoker" \
  --region "$REGION" \
  --project "$PROJECT_ID"
```

## 7. Register in Vertex AI Agent Builder

1. Open the Agent Builder console for your project.
2. Go to **Tools → Add tool → MCP server**.
3. Set the endpoint URL to the Cloud Run service URL printed by step 5
   (format: `https://tripsync-mcp-HASH-REGION.run.app`).
4. Agent Builder will auto-discover the tool list via the MCP manifest endpoint.
   Confirm only `find`, `insert-one`, `update-one`, `aggregate` appear.
5. Save and attach the tool to the Tripsync agent.

## Allowed tools

Only the following MCP primitives are exposed (enforced via `MDB_MCP_ALLOWED_TOOLS`):

| Primitive | Used by |
|---|---|
| `find` | `find_trip`, `list_members`, `get_trip_history` |
| `insert-one` | `insert_proposal`, `append_vote`, `append_history` |
| `update-one` | `update_trip` |
| `aggregate` | `tally_votes` |

All other mongodb-mcp-server tools (`deleteOne`, `dropCollection`, `listDatabases`, …) are blocked.

## Updating the image

```bash
docker build -t "$IMAGE:latest" .
docker push "$IMAGE:latest"
gcloud run services update tripsync-mcp \
  --image "$IMAGE:latest" \
  --region "$REGION" \
  --project "$PROJECT_ID"
```
