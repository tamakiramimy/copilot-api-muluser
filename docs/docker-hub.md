# Copilot API Muluser

GitHub Copilot API proxy with OpenAI, OpenAI Responses, and Anthropic Messages compatibility. It routes new client sessions across enabled GitHub Copilot accounts by least active load while keeping each session bound to its selected account.

Source: https://github.com/tamakiramimy/copilot-api-muluser

## Pull

```bash
docker pull tamakiramimy/copilot-api-muluser:latest
```

Use an immutable UTC release tag when reproducibility matters:

```bash
docker pull tamakiramimy/copilot-api-muluser:vYYYYmmddHHmmss
```

Images support `linux/amd64` and `linux/arm64`.

## Publishing

Pushing a UTC tag that matches `vYYYYmmddHHmmss` automatically runs GitHub Actions to publish the immutable version tag and update `latest` on Docker Hub. The same tag also creates or updates the corresponding GitHub Release. Both workflows can be manually dispatched for an existing UTC release tag.

## Run

```bash
export LOCAL_ACCESS_PASSWORD="$(openssl rand -base64 24)"

docker run -d \
  --name copilot-api-muluser \
  -p 127.0.0.1:4141:4141 \
  -e HOST=0.0.0.0 \
  -e LOCAL_ACCESS_MODE=container-bridge \
  -e LOCAL_ACCESS_PASSWORD="${LOCAL_ACCESS_PASSWORD}" \
  -v copilot-data:/data \
  --restart unless-stopped \
  tamakiramimy/copilot-api-muluser:latest
```

Open `http://127.0.0.1:4141/admin` and add GitHub accounts through Device Flow. Keep the port mapped to `127.0.0.1`; the admin UI and token endpoint are management surfaces. In container bridge mode they require HTTP Basic authentication with username `copilot` and the password set in `LOCAL_ACCESS_PASSWORD`.

## Multi-Account Routing

- Every saved account owns independent GitHub/Copilot tokens, model data, cooldown state, rate limiting, and request capacity.
- New client sessions select from all eligible accounts by least active load.
- A selected account remains sticky for 30 minutes, preserving multi-turn context.
- Clients do not send an account or end-user ID. Configure separate `COPILOT_API_CLIENT_KEYS` values for DeepSeek Harness Electron and sub2api to keep their opaque session namespaces separate.
- The active account in the web UI only controls administrative Models, Usage, and manual model tests; it never pins client requests to one account.

## Model Tests

The `/admin` Models view lists supported endpoints and includes a Test button for every catalog model. It sends `请回复一个${模型名称}` through the model's declared `/responses`, `/v1/messages`, or `/chat/completions` endpoint and displays the returned text.