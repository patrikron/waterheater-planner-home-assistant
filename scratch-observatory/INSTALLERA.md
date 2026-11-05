# Observatory-sajten – installation

En egen sajt som visar huset med live-data från Home Assistant. Den består av en liten
Node-server utan beroenden plus en statisk sida.

```
Home Assistant  ──WebSocket (token)──▶  server.mjs  ──JSON + live-ström──▶  webbläsare
```

- Token finns bara i serverns `.env`. Den skickas aldrig till webbläsaren.
- Servern skickar bara vidare entiteterna som står i `config.json`, och bara de attribut som listas där.
- Värden uppdateras direkt när de ändras i HA, och historikkurvan hämtas från recordern var 5:e minut.
- Om HA tappar anslutningen visas allt som okänt (inga gamla värden) och servern kopplar upp igen själv.

## 1. Skapa token i HA

Det bästa är att skapa en separat användare, till exempel `observatory`, som inte är administratör.
Logga in som den användaren och gå till **Profil → Säkerhet → Långlivade åtkomsttoken → Skapa token**.
Kopiera token direkt, eftersom den bara visas en gång.

> En HA-token kan läsa alla entiteter (det finns ingen behörighet per entitet i HA). Därför filtrerar servern
> och skickar bara vidare det som står i `config.json`.

## 2. Lägg filerna på servern

Kopiera hela mappen `observatory-site/` till exempelvis `/home/server/docker/observatory/`.

```sh
cd /home/server/docker/observatory
cp .env.example .env
nano .env        # fyll i HA_URL och HA_TOKEN
```

`HA_URL` är HA:s adress sett från servern, till exempel `http://192.168.x.x:8123`.
Använd serverns LAN-IP om HA körs i Docker med host-nätverk.

## 3. Starta

Med Docker (rekommenderas):

```sh
docker compose up -d --build
docker logs -f observatory     # ska skriva "Ansluten till Home Assistant"
```

Eller direkt med Node 22+:

```sh
set -a; . ./.env; set +a; node server.mjs
```

Öppna sedan `http://<serverns-ip>:8780` från en dator, platta eller TV i hemnätet.

## Ändra entiteter

Redigera `config.json` och kör `docker compose restart`. Under `card` finns samma nycklar som i
HA-kortet. Under `attributes` anger du vilka attribut som får följa med för en entitet
(till exempel `temperature` på varmvattenberedaren).

## Säkerhet

- Exponera **inte** port 8780 mot internet. Använd den i hemnätet, eller via VPN/Tailscale om du vill nå den utifrån.
- Vill du ha lösenord: sätt `BASIC_AUTH=användare:lösenord` i `.env`. Det ger bara grundläggande skydd över http.
- `/healthz` svarar 200 när servern är ansluten till HA och 503 när den inte är det (används av Dockers healthcheck).

## Filer

| Fil | Vad |
| --- | --- |
| `server.mjs` | Servern: HA-WebSocket, filtrering, `/api/states`, `/api/stream` (SSE), `/api/stats` |
| `config.json` | Vilka entiteter som visas |
| `public/` | Sidan. `observatory-card.js` är samma kort som förhandsbilden |
| `Dockerfile`, `docker-compose.yml` | Container på din server |
| `.env.example` | Mall för HA_URL / HA_TOKEN |

Utseendet är inspirerat av prmgr-observatory-starter (MIT).
