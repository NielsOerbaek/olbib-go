# Kør din egen Olbib Go

Olbib Go er let at køre selv. Serveren er et enkelt Node.js-program uden afhængigheder, den gemmer ingen data om brugerne, og den kræver kun lidt maskinkraft. Har du din egen server, deler du ikke IP-adresse med andre brugere, og så rammer begrænsninger fra bibliotekerne kun dig.

## Det skal du bruge

- **En lille Linux-server** (VM eller VPS), fx Debian 12 eller Ubuntu 24.04. 1 CPU og 1 GB RAM er rigeligt.
- **Et domæne eller et underdomæne**, fx `lydbog.ditdomæne.dk`, med en DNS-post (A eller AAAA), der peger på serverens IP-adresse.
- **Node.js 24.**
- **Caddy** som reverse proxy. Caddy henter og fornyer selv HTTPS-certifikater, og HTTPS er nødvendigt for, at appen kan lægges på hjemmeskærmen.
- Port 80 og 443 åbne ind til serveren.

## 1. Installér Node.js og Caddy

Node.js 24 (her via NodeSource):

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs git
node --version   # skal være v24.x
```

Caddy installeres efter vejledningen på [caddyserver.com/docs/install](https://caddyserver.com/docs/install). På Debian og Ubuntu er det et par linjer, der tilføjer Caddys apt-arkiv og installerer pakken `caddy`.

## 2. Hent koden og opret en bruger

```sh
sudo useradd --system --create-home --home-dir /opt/olbib-go --shell /usr/sbin/nologin olbib
sudo -u olbib git clone https://github.com/NielsOerbaek/olbib-go.git /opt/olbib-go/app
sudo -u olbib mkdir -m 700 /opt/olbib-go/data
```

Der skal ikke køres `npm install`. Serveren bruger kun Node's indbyggede moduler, og afspilleren til andre browsere end Safari ([hls.js](https://github.com/video-dev/hls.js)) ligger allerede i `public/vendor/`.

## 3. Kør serveren som en systemd-service

Opret `/etc/systemd/system/olbib-go.service`:

```ini
[Unit]
Description=Olbib Go
After=network-online.target
Wants=network-online.target

[Service]
User=olbib
WorkingDirectory=/opt/olbib-go/app
Environment=HOST=127.0.0.1
Environment=PORT=3800
Environment=LYD_DATA=/opt/olbib-go/data
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
RestartSec=3
# lidt ekstra afskærmning
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/olbib-go/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Start den:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now olbib-go
systemctl status olbib-go          # skal vise "lyd on http://127.0.0.1:3800 (log off)"
curl -s http://127.0.0.1:3800/api/me   # {"name":null,"loggedOut":true}
```

Første gang serveren starter, laver den en tilfældig hemmelighed i `/opt/olbib-go/data/secret`. Den bruges til at kryptere brugernes cookies og til at beregne enheds-id'er til lydbøger. **Tag en kopi af den, og udskift den ikke.** En ny hemmelighed logger alle ud og giver hvert lånerkort et nyt enheds-id hos WeDoBooks. Der er højst 6 enheder pr. konto, så det bruger en ekstra plads (se [README](README.md#lydbøger)).

## 4. Sæt Caddy foran

Erstat indholdet af `/etc/caddy/Caddyfile` (eller tilføj en blok) med dit domæne:

```caddyfile
lydbog.ditdomæne.dk {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Robots-Tag "noindex, nofollow"
	}
	reverse_proxy 127.0.0.1:3800
}
```

```sh
sudo systemctl reload caddy
```

Åbn `https://lydbog.ditdomæne.dk` i en browser. Caddy har hentet et certifikat i løbet af få sekunder, og du skulle se login-siden med kommunevælgeren.

Caddy sender automatisk `X-Forwarded-For` med. Serveren bruger det til hastighedsbegrænsning pr. IP og til at afvise `/api/stats` udefra. Lad derfor kun Caddy tale med serveren: den lytter på `127.0.0.1`, så det er allerede tilfældet.

## 5. Læg appen på telefonen

- **iPhone:** åbn adressen i Safari, tryk Del → Føj til hjemmeskærm.
- **Android:** åbn adressen i Chrome, vælg Føj til startskærm i menuen.

Vælg kommune, og log ind med lånernummer og pinkode.

## Drift

**Opdatér** til den nyeste version:

```sh
sudo -u olbib git -C /opt/olbib-go/app pull
sudo systemctl restart olbib-go
```

Appen på telefonen henter selv de nye filer næste gang, den åbnes (servicearbejderen spørger altid serveren først).

**Trafiktællere** (anonyme, kun fra selve serveren):

```sh
curl -s http://127.0.0.1:3800/api/stats
```

**Logning** er slået fra. Slå den midlertidigt til ved at tilføje `Environment=LYD_LOG=1` i service-filen, køre `sudo systemctl daemon-reload && sudo systemctl restart olbib-go` og læse med `journalctl -u olbib-go -f`. Fjern linjen igen bagefter. Se [README](README.md#logning) for, hvad der logges.

**Indstillinger:** loftet over samtidige anmodninger til bibliotekerne og køens længde kan ændres med `LYD_UPSTREAM_CONCURRENCY` og `LYD_UPSTREAM_QUEUE`. Se tabellen i [README](README.md#kør-lokalt).

## Godt at vide

- **Del gerne, men med omtanke.** Alle, der bruger din server, deler dens IP-adresse over for bibliotekerne. Bliver I mange, kan bibliotekets tjenester begrænse eller spærre IP-adressen.
- **Andres loginoplysninger.** Lader du andre end din egen husstand bruge din server, behandler du deres personoplysninger. Det gælder lånernummer, pinkode og deres lån, også selvom intet gemmes på serveren. Læs [Hvad gemmes hvor](README.md#hvad-gemmes-hvor), og fortæl dem det.
- `ops/` i repoet er opsætningen til forfatterens egen server (en systemd-brugerservice bag en Caddy i Docker). Den behøver du ikke.
