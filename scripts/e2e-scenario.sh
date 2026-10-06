#!/usr/bin/env bash
# Scénario de bout en bout contre http://localhost:3000/v1 :
# Usage : npm run build && npm start (autre terminal), puis bash scripts/e2e-scenario.sh.
# Libellés en ASCII : sous Windows, curl transmet ses arguments dans le jeu de
# caractères ANSI, ce qui abîmerait les caractères accentués du corps JSON.
# inscription → push → pull → conflit depuis un second appareil → résolution → suppression du compte.
set -u
API=http://localhost:3000/v1
OUT=$(mktemp)
EMAIL="scenario.$(date +%s)@example.com"
PASS='correct horse battery'
DESKTOP_ID=$(node -e "console.log(crypto.randomUUID())")
PHONE_ID=$(node -e "console.log(crypto.randomUUID())")
LIST=list_$(node -e "console.log(crypto.randomUUID())")
DEPL=depl_$(node -e "console.log(crypto.randomUUID())")

j() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=(${1});console.log(typeof v==='string'?v:JSON.stringify(v))"; }

# call MÉTHODE CHEMIN [JETON] [CORPS] [CLÉ] — écrit le corps dans $OUT, renvoie le statut.
call() {
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json' -H 'X-Client-Version: 0.0.9')
  [ -n "${3:-}" ] && args+=(-H "Authorization: Bearer $3")
  [ -n "${4:-}" ] && args+=(--data "$4")
  [ -n "${5:-}" ] && args+=(-H "Idempotency-Key: $5")
  curl "${args[@]}"
}
key() { node -e "console.log(crypto.randomUUID())"; }
step() { echo; echo "== $1"; }

list_json() { echo "{\"id\":\"$LIST\",\"name\":\"$1\",\"forceDispositionId\":\"disposition-a\",\"units\":[{\"id\":\"unit_1\",\"name\":\"Skitarii Rangers\",\"modelCount\":10,\"modelGroups\":[{\"id\":\"grp_1\",\"name\":\"Ranger\",\"count\":10,\"baseShapeId\":\"round-25\"}],\"color\":\"#A1B2C3\"}],\"updatedAt\":\"$2\"${3:+,\"versionToken\":\"$3\"}}"; }
depl_json() { echo "{\"id\":\"$DEPL\",\"name\":\"$1\",\"listId\":\"$LIST\",\"opponentDispositionId\":\"disposition-b\",\"boardId\":\"board-1\",\"placements\":[{\"idUnite\":\"unit_1\",\"idModele\":\"grp_1#1\",\"x\":120,\"y\":300,\"rotation\":45}],\"reservedUnitIds\":[],\"note\":\"$4\",\"updatedAt\":\"$2\"${3:+,\"versionToken\":\"$3\"}}"; }

step "GET /health"
curl -s http://localhost:3000/health; echo

step "1. Bureau : POST /auth/register"
S=$(call POST /auth/register "" "{\"email\":\"  ${EMAIL^^}\",\"password\":\"$PASS\",\"device\":{\"id\":\"$DESKTOP_ID\",\"name\":\"Chrome - Windows\",\"platform\":\"web\"}}")
echo "statut $S — email normalisé : $(j 'd.user.email' < "$OUT")"
DESKTOP=$(j 'd.deviceToken' < "$OUT")

step "2. Bureau : GET /sync/summary"
S=$(call GET /sync/summary "$DESKTOP"); echo "statut $S — $(cat "$OUT")"

step "3. Bureau : POST /sync/changes (liste + déploiement)"
S=$(call POST /sync/changes "$DESKTOP" "{\"since\":\"\",\"lists\":[$(list_json 'Skitarii - 2000 pts' 2026-10-06T10:00:00.000Z)],\"deployments\":[$(depl_json 'Plan A' 2026-10-06T10:05:00.000Z '' '')]}" "$(key)")
echo "statut $S — $(cat "$OUT")"

step "4. Bureau : GET /sync/changes (pull complet)"
S=$(call GET "/sync/changes" "$DESKTOP"); echo "statut $S — listes $(j 'd.lists.length' < "$OUT"), déploiements $(j 'd.deployments.length' < "$OUT"), nextToken $(j 'd.nextToken' < "$OUT"), hasMore $(j 'd.hasMore' < "$OUT")"

step "5. Téléphone : POST /auth/login, GET /sync/summary, pull complet"
S=$(call POST /auth/login "" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"device\":{\"id\":\"$PHONE_ID\",\"name\":\"Pixel 8\",\"platform\":\"android\"}}")
echo "login statut $S"
PHONE=$(j 'd.deviceToken' < "$OUT")
S=$(call GET /sync/summary "$PHONE"); echo "summary statut $S — $(cat "$OUT")"
S=$(call GET "/sync/changes" "$PHONE"); echo "pull statut $S — déploiement $(j 'd.deployments[0].name+" @ "+d.deployments[0].versionToken' < "$OUT"), nextToken $(j 'd.nextToken' < "$OUT")"

step "6. Bureau puis téléphone modifient le déploiement à partir du jeton 2"
S=$(call POST /sync/changes "$DESKTOP" "{\"since\":\"2\",\"deployments\":[$(depl_json 'Plan A - bureau' 2026-10-06T11:00:00.000Z 2 'flanc gauche')]}" "$(key)")
echo "bureau statut $S — $(j 'd.accepted' < "$OUT")"
S=$(call POST /sync/changes "$PHONE" "{\"since\":\"2\",\"deployments\":[$(depl_json 'Plan A - telephone' 2026-10-06T11:30:00.000Z 2 'flanc droit')]}" "$(key)")
echo "téléphone statut $S — accepted $(j 'd.accepted.length' < "$OUT"), conflit : $(j '({kind:d.conflicts[0].kind, serveur:d.conflicts[0].serverRecord.name, date:d.conflicts[0].serverUpdatedAt, appareil:d.conflicts[0].serverDevice.name, jeton:d.conflicts[0].serverVersionToken})' < "$OUT")"
TOKEN=$(j 'd.conflicts[0].serverVersionToken' < "$OUT")

step "7. Téléphone : POST /sync/conflicts/resolve (keepLocal)"
RKEY=$(key)
BODY="{\"resourceType\":\"deployment\",\"id\":\"$DEPL\",\"kind\":\"bothModified\",\"resolution\":\"keepLocal\",\"serverVersionToken\":\"$TOKEN\",\"localRecord\":$(depl_json 'Plan A - telephone' 2026-10-06T11:30:00.000Z '' 'flanc droit')}"
S=$(call POST /sync/conflicts/resolve "$PHONE" "$BODY" "$RKEY"); echo "statut $S — $(j '({deleted:d.deleted, name:d.record.name, versionToken:d.versionToken})' < "$OUT")"
S=$(call POST /sync/conflicts/resolve "$PHONE" "$BODY" "$RKEY"); echo "rejeu même clé : statut $S — versionToken $(j 'd.versionToken' < "$OUT")"

step "8. Bureau : pull delta depuis 3"
S=$(call GET "/sync/changes?since=3" "$DESKTOP"); echo "statut $S — $(j 'd.deployments.map(x=>x.name+" / "+x.note+" @ "+x.versionToken)' < "$OUT"), nextToken $(j 'd.nextToken' < "$OUT")"

step "9. Téléphone : résolution périmée (même conflit, autre clé)"
S=$(call POST /sync/conflicts/resolve "$PHONE" "$BODY" "$(key)"); echo "statut $S — $(j 'd.code' < "$OUT")"

step "10. Bureau : POST /account/delete"
S=$(call POST /account/delete "$DESKTOP" "{\"password\":\"$PASS\"}"); echo "statut $S"
S=$(call GET /account "$PHONE"); echo "téléphone GET /account : statut $S — $(j 'd.code' < "$OUT")"
S=$(call POST /auth/login "" "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"device\":{\"id\":\"$PHONE_ID\",\"name\":\"Pixel 8\",\"platform\":\"android\"}}"); echo "reconnexion : statut $S — $(j 'd.code' < "$OUT")"

rm -f "$OUT"
