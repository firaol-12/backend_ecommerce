#!/bin/bash
set -e
BASE=http://localhost:5000/api
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$2" 2>/dev/null || echo ""; }

email="buyer$(date +%s)@test.com"
pw="Buyer@123456"

# register (or login if exists)
TOKEN=$(curl -s -X POST $BASE/auth/register -H 'Content-Type: application/json' \
  -d "{\"first_name\":\"Test\",\"last_name\":\"Buyer\",\"email\":\"$email\",\"password\":\"$pw\",\"phone\":\"0911111111\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])" 2>/dev/null || true)
if [ -z "$TOKEN" ]; then
  TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$pw\"}" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
fi
echo "EMAIL=$email"

SID=$(curl -s -X POST $BASE/addresses -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Test Buyer\",\"phone\":\"0911111111\",\"street\":\"Bole\",\"city\":\"Addis Ababa\",\"state\":\"Addis\",\"postal_code\":\"1000\",\"country\":\"Ethiopia\",\"address_type\":\"shipping\",\"is_default\":true}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['address']['id'])")
BID=$(curl -s -X POST $BASE/addresses -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"full_name\":\"Test Buyer\",\"phone\":\"0911111111\",\"street\":\"Bole\",\"city\":\"Addis Ababa\",\"state\":\"Addis\",\"postal_code\":\"1000\",\"country\":\"Ethiopia\",\"address_type\":\"billing\",\"is_default\":true}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['address']['id'])")
echo "SID=$SID BID=$BID"

PID=$(curl -s "$BASE/products?limit=1" | python3 -c "import sys,json;print(json.load(sys.stdin)['products'][0]['id'])")
echo "PRODUCT_ID=$PID"
echo "ADD_CART=$(curl -s -X POST $BASE/cart -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"product_id\":$PID,\"quantity\":1}")"

echo "SHIP=$SID BILL=$BID" > /tmp/chapa_env.txt
echo "TOKEN=$TOKEN" >> /tmp/chapa_env.txt