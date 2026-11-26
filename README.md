# Olbib Go

En lille, uofficiel webapp til at låne og lytte til **lydbøger** fra folkebibliotekernes børneunivers [Biblo GO!](https://biblogo.dk) (tidligere eReolen GO), lavet til ældre telefoner. Man vælger sin kommune ved login, og appen taler så med den kommunes GO-side.

> Olbib Go er et privat hobbyprojekt. Det er ikke lavet af, godkendt af eller tilknyttet Biblo GO!, Det Digitale Folkebibliotek, Københavns Biblioteker eller andre biblioteker, DBC eller WeDoBooks.

<p>
  <img src="docs/screenshots/2-mine-laan.png" width="190" alt="Mine lån med lydbøgerne i to kolonner">
  <img src="docs/screenshots/2b-andre-laan.png" width="190" alt="Andre lån foldet ud: e-bøger, hjemlånte bøger og reserveringer">
  <img src="docs/screenshots/3-soeg.png" width="190" alt="Søgning med filter for lydbøger">
  <img src="docs/screenshots/4-titel.png" width="190" alt="En titel med knap til at låne lydbogen">
  <img src="docs/screenshots/5-afspiller.png" width="190" alt="Lydbogsafspilleren med søvntimer">
</p>

*Mine lån viser eksempeldata. Skærmbillederne er taget med `tools/screenshots.mjs`.*

## Hvorfor

Biblo GO! er en del af Det Digitale Folkebibliotek, og omkring 100 biblioteker i Danmark, på Færøerne, i Grønland og i Sydslesvig har hver deres GO-side. GO virker ikke på vores gamle iPhone, som kører iOS 16 og ikke kan opdateres. Telefonen er ellers fin til at lytte til lydbøger, og et barn kan sagtens bruge den. Det eneste, der mangler, er en vej ind til bibliotekets bøger.

Olbib Go er den vej ind, og den handler om lydbøger. Det er en simpel webapp, der kan lægges på hjemmeskærmen i Safari (en såkaldt PWA). Den taler med de samme tjenester som GO, med ens eget lånerkort og pinkode, og viser det hele i en brugerflade, der virker i en gammel Safari.

## Hvad kan den

- **Logge ind** i sin egen kommune med lånernummer eller CPR og pinkode. Man forbliver logget ind på telefonen.
- **Dine lydbøger** står øverst i to kolonner, med hvor langt man er nået.
- **Søge** efter lydbøger mens man skriver. Filteret "Alt" viser også andre formater.
- **Låne** lydbøger.
- **Lytte:** ±30 sekunder, afspilningshastighed, husker hvor man kom til, styring fra låseskærmen og en søvntimer.
- **Andre lån** (e-bøger, hjemlånte bøger og reserveringer) står i en sammenfoldet liste nedenunder. Man kan se dem, forny hjemlånte bøger og slette reserveringer.

Appen kan **ikke** låne e-bøger eller reservere fysiske bøger. Det gør man i GO, og en titelside siger, hvis bogen også findes i andre formater. Serveren afviser også selv lån af andet end lydbøger. E-bøger kan heller ikke læses i appen, se [E-bøger](#e-bøger).

Appen er brugt og testet med Københavns Biblioteker. De andre kommuners GO-sider er bygget på samme måde, og deres opsætning er testet, men ikke login med et rigtigt lånerkort.

## Telefoner og browsere

- **Ældre iPhones** (testet med iOS 16): åbn appen i Safari og vælg Del → Føj til hjemmeskærm. Så kører den som en app i fuld skærm.
- **Ældre Android-telefoner:** åbn appen i Chrome og vælg Føj til startskærm i menuen. Den virker på samme måde som PWA.
- **Andre browsere:** appen virker også i almindelige browsere på computer og telefon, fx Firefox, Chrome og Safari.

## Hvad gemmes hvor

Kort sagt: **serveren gemmer ingenting om brugerne.** Alt om et login ligger krypteret i brugerens egen cookie, og serverens log er slået fra.

| Hvor | Hvad | Hvor længe |
|---|---|---|
| **Brugerens cookie** (`lyd`) | Ét krypteret felt med valgt kommune, GO's session-cookies, lånernummer og pinkode (så serveren kan logge ind igen, når GO's session udløber efter cirka et døgn), navnet fra GO og enheds-id'et til lydbøger. | Indtil man logger ud, højst 180 dage |
| **Telefonens browser** (localStorage) | Hvor langt man er nået i hver lydbog, den seneste lydbog, afspilningshastighed, valgt søgefilter, senest valgte kommune og om "Andre lån" er foldet ud. | Indtil browserdata slettes |
| **Serverens disk** | Kun en tilfældig hemmelighed (`secret`), som bruges til at kryptere cookies og beregne enheds-id'er. Ingen brugerliste, ingen sessioner. | Fast |
| **Serverens hukommelse** | Kortlivede billetter til lydbogsafspilning (30 min), midlertidige Firebase-tokens (1 time), hvilke enheder der er registreret, tællere til hastighedsbegrænsning, tidspunkter for fejlede logins pr. IP, anonyme trafiktællere og kommunernes opsætning. | Forsvinder ved genstart |
| **Serverens log** | Intet. Logning er slået fra som standard. | – |

Serveren ser naturligvis de data, der passerer igennem den, mens en anmodning står på, fordi den er mellemled til GO. Den gemmer dem bare ikke.

Cookien er krypteret og autentificeret med AES-256-GCM. Den er `HttpOnly`, `Secure` og `SameSite=Lax`, så JavaScript ikke kan læse den, og den ikke sendes med, når andre sider laver anmodninger i baggrunden. En ændret eller for gammel cookie bliver afvist. Hvis serverens hemmelighed udskiftes, bliver alle logget ud.

### Trafik og belastning

Alle brugere deler serverens IP-adresse over for bibliotekets tjenester. Mange anmodninger fra én IP kan føre til, at den bliver begrænset eller blokeret, og så rammer det alle. Derfor:

- **Loft over samtidige anmodninger:** højst 12 anmodninger til bibliotekets tjenester ad gangen (`LYD_UPSTREAM_CONCURRENCY`). Resten venter i kø, højst 200 og højst 20 sekunder (`LYD_UPSTREAM_QUEUE`). Bliver køen fuld, svarer appen "Der er travlt lige nu".
- **Hastighedsbegrænsning pr. bruger:** 90 anmodninger i minuttet (med plads til en kort spids på 40), 300 forsider i minuttet og 10 loginforsøg i minuttet pr. IP. Derudover højst 5 fejlede logins pr. kvarter pr. IP, så forkerte pinkoder ikke får Adgangsplatformen til at spærre serverens IP. Udlogning er aldrig begrænset.
- **Ingen cache:** svar fra bibliotekets tjenester gemmes ikke. Kun kommunernes opsætning og filiallister holdes i hukommelsen.
- **Anonyme tællere:** antal anmodninger pr. type og statuskode, anmodninger til bibliotekerne, fejl og svar med 429 fra bibliotekerne, hvor mange der blev begrænset, samt kø og samtidighed. Både i alt og minut for minut den seneste time. Der er ingen id'er, IP-adresser, titler eller kommuner i tællerne. De kan kun hentes direkte på serveren, ikke gennem den offentlige adresse:

  ```sh
  curl -s http://<HOST>:<PORT>/api/stats
  ```

  Anmodninger, der kommer gennem en reverse proxy (med `X-Forwarded-For`), får 404.

### Logning

Logning er slået fra. Til fejlsøgning kan den slås til med `LYD_LOG=1`. Så logger serveren hver API-anmodning (metode, sti, status, tid og browser), fejl, og fejl som appen selv indberetter, fx hvis en lydbog ikke kan afspilles. Stien kan indeholde id'et på en titel eller et lån. Lånernumre, pinkoder, søgeord og billet-URL'er logges aldrig.

## Teknisk løsning

```
 iPhone (Safari, iOS 16)                     Server (Node.js)                    Bibliotekets tjenester
┌──────────────────────┐   HTTPS / JSON   ┌───────────────────────┐   HTTPS   ┌──────────────────────────────────┐
│ public/  (PWA)       │ ───────────────▶ │ server/index.mjs      │ ────────▶ │ login.bib.dk (Adgangsplatformen) │
│ vanilla JS, ingen    │                  │  login + sessioner    │           │ kommunens GO-side /ap-service:   │
│ build-trin           │ ◀─────────────── │  proxy til GO's API'er│ ◀──────── │   FBI (søgning), FBS (hjemlån),  │
│                      │                  │  cover-proxy          │           │   biblio (digitale lån)          │
│ <audio> ◀── HLS ─────┼──────────────────┼───────────────────────┼─────────▶ │ WeDoBooks (Firebase + CDN)       │
└──────────────────────┘                  └───────────────────────┘           └──────────────────────────────────┘
```

Frontend og backend er bevidst simple: ingen frameworks, ingen build-trin og ingen runtime-afhængigheder på serveren, kun Node.js 24's indbyggede `fetch` og `http`.

### Hvorfor en server?

GO er en Next.js-app, og dens API'er under `/ap-service` er lavet til at blive kaldt fra GO's eget domæne. En webapp på et andet domæne kan ikke kalde dem direkte fra browseren, og den kan heller ikke gennemføre login-flowet, som springer mellem tre domæner med cookies. Serveren gør derfor det, en browser på GO ville gøre, og giver appen et lille, stabilt JSON-API.

### Kommuner

Listen over kommuner og deres GO-adresser kommer fra kommunevælgeren på [biblogo.dk](https://biblogo.dk) og ligger i `server/municipalities.json` (opdateres med `node tools/update-municipalities.mjs`). Alle GO-sider er den samme app, og hver side har sin egen opsætning indlejret i siden (`dplCmsConfig`):

- bibliotekets navn og login-link (fx `https://www.aakb.dk/login?current-path=/go-login`),
- om lydbøger og e-bøger er slået til (det er de fx ikke i Grønland),
- Firebase-opsætning til lydbøger,
- filialer, der ikke skal med i tilgængelighed.

Serveren læser opsætningen fra kommunens GO-side og holder den i hukommelsen i nogle timer. Søgninger begrænses til bibliotekets egne filialer, som hentes fra FBS (`/fbs/external/v1/agencyid/branches`).

### Login

Login går gennem Adgangsplatformen ([login.bib.dk](https://login.bib.dk), DBC's open source-projekt [hejmdal](https://github.com/DBCDK/hejmdal)):

1. Serveren åbner kommunens login-link, som via bibliotekets hjemmeside (fx `bibliotek.kk.dk`) sender videre til `login.bib.dk/oauth/authorize`.
2. Login-siden er forudvalgt til biblioteket. Serveren læser bibliotekets nummer og navn fra formularen og sender dem sammen med lånernummer og pinkode (identitetsudbyderen "borchk").
3. Redirect-kæden fortsætter tilbage via bibliotekets hjemmeside til GO-sidens `/auth/callback/...`, som sætter GO's session-cookie.
4. GO's cookies krypteres ind i brugerens egen cookie (se [Hvad gemmes hvor](#hvad-gemmes-hvor)). GO's `/ap-service` accepterer GO's session-cookie alene. Når GO fornyer sine cookies, sender serveren en opdateret cookie med i svaret.

Fejlkoder fra hejmdal (`bonfd`, `bonui`, `tmul` …) oversættes til danske beskeder. Adgangsplatformen tæller forkerte forsøg både pr. bruger og pr. IP-adresse. Alle brugere af én server deler IP-adresse, så serveren tillader højst fem fejlede logins pr. kvarter pr. klient.

### Bibliotekets API'er

Alt går gennem kommunens GO-side, fx `https://go.bibliotek.kk.dk/ap-service/…`:

| Formål | Endpoint |
|---|---|
| Søgning og værker | `POST /fbi`: DBC's FBI GraphQL (`searchWithPagination`, `getMaterial`, `getManifestationsByFaust`). Forespørgslerne ligger i `server/queries/`. |
| Filtrering på type | FBI-filteret `materialTypesSpecific`: `lydbog (online)`, `e-bog`, `bog` |
| Hjemlån, fornyelse, gebyrer | `GET /fbs/external/agencyid/patrons/patronid/loans/v2`, `POST …/loans/renew/v2`, `GET …/patron/patronid/fees/v2` |
| Reserveringer | `GET /fbs/external/v1/agencyid/patrons/patronid/reservations/v2`, `DELETE …/reservations?reservationid=` |
| Digitale lån | `GET/POST /biblio/v1/loans` (lån med `{ "material_id": "<ISBN>" }`, kun lydbøger) |
| Metadata og forsider for digitale titler | `GET /pubhub-adapter/v1/products/<ISBN>` (`productType` 2 er lydbog) |

FBS-endpointsene er dokumenteret i den åbne OpenAPI-beskrivelse i [dpl-react](https://github.com/danskernesdigitalebibliotek/dpl-react) (`src/core/fbs/fbs-adapter.yaml`). Resten er fundet ved at se på den trafik, GO selv sender, når man bruger GO med sin egen konto.

### Lydbøger

Lydbøger leveres af WeDoBooks via Firebase:

1. `POST /ap-service/biblio/v1/auth/create-sign-in-token` giver et Firebase custom token.
2. Det byttes til et ID-token hos Google Identity Toolkit (`accounts:signInWithCustomToken`) med GO's offentlige Firebase-nøgle. Nøglen ligger ikke i koden: serveren læser den fra kommunens GO-side (`firebaseApiKey`).
3. Afspilleren registreres som en "enhed" (`Devices-add`, `Devices-set_active`). WeDoBooks tillader **højst 6 enheder pr. konto**, så Olbib Go bruger ét fast enheds-id pr. lånerkort (en HMAC af lånernummeret med en hemmelighed på serveren). Ellers ville hvert nyt login bruge en enhed.
4. `Streaming-audiobook_playlist?checkoutId=…` returnerer en HLS-playliste (AES-128) med signerede URL'er til lydfiler og nøgle på WeDoBooks' CDN.

Appen får playlisten fra sin egen server via en kortlivet billet-URL, og afspillerens `<audio>`-element henter selv lydfilerne fra CDN'et. Safari, også på iOS 16, afspiller HLS direkte. Andre browsere (Firefox, Chrome) bruger [hls.js](https://github.com/video-dev/hls.js), som kun hentes, når der er brug for det.

iOS tillader kun, at lyd startes direkte i et tryk. Billetten hentes derfor allerede, når afspilleren åbnes, så `play()` kan kaldes med det samme, når man trykker.

### E-bøger

E-bøger er kopibeskyttede. GO's læser (Colibrio) sender en offentlig RSA-nøgle til `Streaming-ebook_resource` og får bogens indhold i AES-256-krypterede stykker, som den dekrypterer i browseren.

Olbib Go genskaber **ikke** den dekryptering. At omgå kopibeskyttelse er ikke tilladt efter ophavsretslovens § 75 c, heller ikke for bøger man har lånt lovligt. Appen viser derfor e-bogslån, men henviser til GO for at læse dem.

### Forsider

Forsiderne ligger på `images.pubhub.dk` og `fbiinfo-present.dbc.dk`. Deres certifikater kæder op til nyere rodcertifikater (Sectigo R46 og ISRG Root YR), som ældre Apple-enheder ikke kender, så Safari afviser billederne. Serveren henter derfor forsiderne og sender dem videre (`/api/cover`), kun for loggede brugere og kun fra de to værter.

## Kode

```
server/
  index.mjs        HTTP-server: API-ruter, statiske filer, cover-proxy, valgfri logning
  go.mjs           Klient til GO's API'er og WeDoBooks/Firebase
  go-login.mjs     Login-flowet og en simpel cookie-krukke
  sites.mjs        Kommuneliste og hver kommunes GO-opsætning
  upstream.mjs     Alle anmodninger til bibliotekerne: loft over samtidighed og tællere
  metrics.mjs      Anonyme trafiktællere
  municipalities.json  Kommuner og GO-adresser fra biblogo.dk
  store.mjs        Krypterer og læser sessionen i brugerens cookie
  queries/         FBI GraphQL-forespørgsler
public/            PWA'en: index.html, app.js, style.css, sw.js, manifest, ikoner, skrift
ops/               systemd-unit og deploy-script
tools/             Værktøjer brugt under udviklingen (se nedenfor)
```

### Kør lokalt

Kræver Node.js 24.

```sh
INSECURE_COOKIE=1 LYD_DATA=data node server/index.mjs
# åbn http://127.0.0.1:3800
```

| Miljøvariabel | Standard | Betydning |
|---|---|---|
| `PORT` / `HOST` | `3800` / `127.0.0.1` | Hvor serveren lytter |
| `LYD_DATA` | `./data` | Mappe til serverens hemmelighed (`secret`) |
| `LYD_LOG` | ikke sat | Sæt til `1` for at slå logning til |
| `LYD_UPSTREAM_CONCURRENCY` | `12` | Højst så mange samtidige anmodninger til bibliotekerne |
| `LYD_UPSTREAM_QUEUE` | `200` | Højst så mange ventende anmodninger |
| `INSECURE_COOKIE` | ikke sat | Sæt til `1` for at køre over almindelig HTTP lokalt |

I drift kører serveren som en systemd-brugerservice (`ops/bibliotek.service`) bag en reverse proxy, der står for HTTPS.

### Udviklingsværktøjer

`tools/` indeholder de scripts, API'et blev kortlagt og testet med:

- `record.mjs` åbner en Chrome med egen profil og gemmer al trafik i `capture/traffic.jsonl`, mens man selv bruger GO.
- `show.mjs` viser udvalgte anmodninger fra optagelsen.
- `smoke.mjs`, `ui-check.mjs`, `player-fit.mjs` og `cover-check.mjs` er røgtest af API og brugerflade mod en kørende server.
- `screenshots.mjs` tager skærmbillederne til denne README, med eksempeldata i stedet for rigtige lån.
- `update-municipalities.mjs` henter listen over kommuner og GO-adresser fra biblogo.dk.
- `devices.mjs` viser (og med `--clean` fjerner) de WeDoBooks-enheder, Olbib Go har registreret.

**Pas på:** optagelsen i `capture/` indeholder dit lånernummer og din pinkode i klar tekst. Mappen er i `.gitignore` og må aldrig deles. Testscriptene læser loginoplysningerne derfra.

## Forbehold

Olbib Go bruger bibliotekets tjenester på samme måde som GO, med brugerens egen konto, og kun til det, brugeren selv har ret til: egne lån, egne reserveringer og afspilning af lånte lydbøger. Den omgår ikke kopibeskyttelse af e-bøger. Bibliotekets API'er er ikke offentligt dokumenterede og kan ændre sig uden varsel, så appen kan holde op med at virke.
