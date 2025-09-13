# Strategia di Scraping Gazzetta Ufficiale - UrbanAI

## 📊 Situazione Attuale
- **Sistema**: Funzionante su urbanator.it
- **Database**: 3 documenti processati (2 embedded) dal test precedente
- **Target**: 154 PDFs trovati per anno 2024
- **Obiettivo**: Migliaia di documenti (1986-2024)

## 🎯 Strategia di Implementazione

### **Fase 1: Completamento Anno 2024**
```bash
# Testare sistema ottimizzato
POST /api/bulk-scrape
{
  "source": "regioni",
  "year": 2024,
  "action": "scrape"
}

# Risultato atteso: 10 documenti per chiamata (da 154 totali)
# Chiamate necessarie: ~15-16 per completare il 2024
```

### **Fase 2: Processamento a Coda**
```bash
# Per i documenti rimanenti
POST /api/queue-processor
{
  "action": "process",
  "batchSize": 5
}

# Poi embeddings
POST /api/queue-processor
{
  "action": "embed", 
  "batchSize": 3
}
```

### **Fase 3: Espansione Storica**
**Target anni ad alta priorità:**
- **2023**: ~150 documenti stimati
- **2022**: ~140 documenti stimati  
- **2021**: ~130 documenti stimati
- **2020**: ~120 documenti stimati (COVID regulations)

**Anni storici (graduale):**
- **2015-2019**: ~100-110 documenti/anno
- **2010-2014**: ~90-100 documenti/anno
- **2000-2009**: ~70-90 documenti/anno
- **1986-1999**: ~50-70 documenti/anno

## 🔧 Ottimizzazioni Tecniche

### **Batch Processing**
- **Scraping**: 5 documenti/batch, max 10/chiamata
- **Processing**: 5 documenti/batch  
- **Embedding**: 3 documenti/batch (rate limits OpenAI)
- **Delay**: 200ms tra documenti, 500ms tra batch

### **Error Handling**
- Continue on individual failures
- Retry logic for temporary errors
- Skip already processed documents

### **Monitoring**
```bash
# Statistiche in tempo reale
GET /api/admin

# Status coda
POST /api/queue-processor {"action": "status"}
```

## 📈 Proiezioni

### **Throughput Stimato**
- **10 docs/call** × **6 calls/hour** = **60 docs/hour**
- **Giornaliero**: ~1,440 documenti (24h continuo)
- **Realistico**: ~300-500 documenti/giorno

### **Timeline Completamento**
- **2024 (154 docs)**: 1 giorno
- **2020-2023 (~540 docs)**: 2-3 giorni  
- **2010-2019 (~1000 docs)**: 4-5 giorni
- **1986-2009 (~1800 docs)**: 7-10 giorni

**Total stimato: ~3,500 documenti in 15-20 giorni**

## 🚀 Comandi di Esecuzione

### Immediate (post-deploy):
```bash
# 1. Test sistema
curl -X POST "https://new-urbanai3.vercel.app/api/bulk-scrape" \
  -d '{"year":2024,"source":"regioni","action":"scrape"}'

# 2. Monitoraggio
curl -X GET "https://new-urbanai3.vercel.app/api/admin"

# 3. Queue processing
curl -X POST "https://new-urbanai3.vercel.app/api/queue-processor" \
  -d '{"action":"process","batchSize":5}'
```

### Automation Script (future):
```javascript
// Automated year-by-year processing
for(let year = 2024; year >= 1986; year--) {
  await bulkScrape(year);
  await processQueue();
  await embedQueue();
}
```