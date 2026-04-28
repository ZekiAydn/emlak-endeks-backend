# Emsal İlan Toplama ve Rapor Snapshot Sistemi

Bu modül sadece açık Google/SerpAPI sonuçlarından `title`, `snippet`, `url` ve varsa `imageUrl` bilgisini toplar. CAPTCHA bypass, proxy rotation, stealth browser, login arkası veri çekme veya doğrudan Sahibinden scraping içermez.

## Dosya Ağacı

```txt
src/providers/
  baseListingProvider.js
  serpListingProvider.js
  manualListingProvider.js
  csvListingProvider.js

src/services/
  comparableSearchService.js
  comparableImportService.js
  comparableSelectionService.js
  comparableReportSnapshotService.js

src/helpers/
  buildComparableSearchQueries.js
  parseComparableFromText.js
  normalizeComparableListing.js
  calculateComparableConfidence.js
  dedupeComparableListings.js
  selectBestComparablesForReport.js
  defaultComparableImage.js

src/controllers/
  comparableController.js

src/routes/
  comparableRoutes.js
```

## Prisma Migration

`prisma/schema.prisma` içine `ComparableListing` modeli, `User.comparables` ve `Report.comparableListings` ilişkileri eklendi. Migration SQL dosyası:

```txt
prisma/migrations/20260428170000_add_comparable_listings/migration.sql
```

Çalıştırılacak komutlar:

```bash
npx prisma format
npx prisma migrate dev --name add_comparable_listings
npx prisma generate
```

## .env

```bash
SERPAPI_KEY=your-serpapi-key
SERPAPI_MAX_RESULTS=10
SERPAPI_TIMEOUT_MS=12000
SERPAPI_DELAY_MS=300
DEFAULT_COMPARABLE_IMAGE_URL=https://emlakskor.com/comparables/no-comparable-image.png
```

`DEFAULT_COMPARABLE_IMAGE_URL` boşsa sistem otomatik olarak `https://emlakskor.com/comparables/no-comparable-image.png` kullanır.

## Endpointler

Tüm endpointler auth gerektirir. `userId` her zaman `req.user.userId` üzerinden alınır; client body içinden `userId` kabul edilmez.

```js
router.post("/search", comparableController.searchComparables);
router.get("/report/:reportId", comparableController.getReportComparables);
router.patch("/:id", comparableController.updateComparable);
router.post("/:id/verify", comparableController.verifyComparable);
router.post("/:id/select", comparableController.selectComparable);
router.post("/:id/unselect", comparableController.unselectComparable);
router.post("/report/:reportId/select-best", comparableController.selectBestForReport);
router.post("/report/:reportId/snapshot", comparableController.snapshotReportComparables);
router.post("/import-csv", upload.single("file"), comparableController.importCsv);
```

Mount path:

```txt
/api/comparables
```

## Arama Örneği

```bash
curl -X POST "http://localhost:4000/api/comparables/search" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reportId": "REPORT_ID",
    "city": "İstanbul",
    "district": "Pendik",
    "neighborhood": "Bahçelievler",
    "propertyType": "Daire",
    "roomCount": 2,
    "salonCount": 1,
    "grossM2": 90,
    "netM2": 80,
    "buildingAge": 5,
    "floor": 3,
    "heating": "Kombi Doğalgaz"
  }'
```

## Manuel Düzenleme

```bash
curl -X PATCH "http://localhost:4000/api/comparables/COMPARABLE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 4250000,
    "grossM2": 90,
    "netM2": 80,
    "roomCount": 2,
    "salonCount": 1,
    "addressText": "İstanbul / Pendik / Bahçelievler",
    "imageUrl": ""
  }'
```

`imageUrl` boş gönderilirse tekrar default görsel atanır ve `imageStatus` `DEFAULT` olur.

## Seçim ve Snapshot

```bash
curl -X POST "http://localhost:4000/api/comparables/report/REPORT_ID/select-best" \
  -H "Authorization: Bearer $TOKEN"

curl -X POST "http://localhost:4000/api/comparables/report/REPORT_ID/snapshot" \
  -H "Authorization: Bearer $TOKEN"
```

Snapshot `Report.comparablesJson` alanına şu ana yapıyla yazılır:

```json
{
  "generatedAt": "ISO_DATE",
  "sourceMode": "SERP_API_WITH_MANUAL_VERIFICATION",
  "targetSelection": { "total": 18, "low": 6, "mid": 6, "high": 6 },
  "actualSelection": { "total": 14, "low": 5, "mid": 4, "high": 5 },
  "summary": {
    "totalFound": 24,
    "totalUsable": 14,
    "totalSelected": 14,
    "averagePrice": 4250000,
    "averagePricePerSqm": 47500,
    "minPrice": 3600000,
    "maxPrice": 5200000,
    "confidenceAverage": 78,
    "imageSummary": {
      "realImageCount": 10,
      "defaultImageCount": 4,
      "defaultImageUrl": "https://emlakskor.com/comparables/no-comparable-image.png"
    }
  },
  "selected": [],
  "excluded": [],
  "warnings": []
}
```

## CSV Import

CSV kolonları:

```txt
source,title,description,price,currency,city,district,neighborhood,addressText,grossM2,netM2,roomCount,salonCount,bathCount,propertyType,buildingAge,floor,totalFloors,heating,imageUrl,listingUrl
```

Örnek dosya:

```txt
docs/comparables-csv-example.csv
```

```bash
curl -X POST "http://localhost:4000/api/comparables/import-csv" \
  -H "Authorization: Bearer $TOKEN" \
  -F "reportId=REPORT_ID" \
  -F "file=@docs/comparables-csv-example.csv"
```

## Eksik Veri Davranışı

- `imageUrl` hiçbir zaman boş bırakılmaz. Gerçek ilan görseli yoksa default URL atanır ve `imageStatus` `DEFAULT` olur.
- `imageStatus` sadece `REAL` veya `DEFAULT` değerlerini alır.
- `price` veya `grossM2/netM2` yoksa kayıt DB’de saklanır, fakat rapor hesaplamasına alınmaz ve snapshot `excluded` listesinde `PRICE_OR_M2_MISSING` olarak görünür.
- `DEFAULT` görselli ilanlar sadece fiyat, m², adres/lokasyon ve `listingUrl` bilgisi yeterliyse otomatik seçime girebilir.
- Otomatik seçimde önce `pricePerSqm` ile LOW/MID/HIGH grupları oluşturulur. Her grup içinde gerçek fotoğraflı ilanlar default görselli ilanlardan önce seçilir.
- Her gruptan en fazla 6 ilan seçilir. Bir grupta eksik varsa diğer gruplardan tamamlanmaz.
- Hedef 18 emsal tamamlanamazsa hata verilmez; snapshot `warnings` içinde kullanılan emsal sayısı yazılır.
- PDF tarafında `imageStatus === "DEFAULT"` olan kartlarda “Temsili görsel” etiketi gösterilebilir.

