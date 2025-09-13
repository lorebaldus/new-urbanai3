// Automation script for UrbanAI Gazzetta Ufficiale scraping
const API_BASE = 'https://new-urbanai3.vercel.app';

class GazzettaScraper {
    constructor() {
        this.stats = {
            totalDocuments: 0,
            processedDocuments: 0,
            embeddedDocuments: 0,
            currentYear: null,
            startTime: Date.now()
        };
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async apiCall(endpoint, data = null, method = 'GET') {
        const config = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        
        if (data) {
            config.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(`${API_BASE}${endpoint}`, config);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`API call failed for ${endpoint}:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async getStats() {
        const result = await this.apiCall('/api/admin');
        if (result.success) {
            this.stats = { ...this.stats, ...result.statistics.overview };
            this.logStats();
        }
        return result;
    }

    async scrapeYear(year, source = 'regioni') {
        console.log(`\n🚀 Starting scrape for year ${year}...`);
        this.stats.currentYear = year;
        
        const result = await this.apiCall('/api/bulk-scrape', {
            year,
            source,
            action: 'scrape'
        }, 'POST');

        if (result.success) {
            console.log(`✅ Year ${year}: Found ${result.totalFound}, processed ${result.processed}, remaining ${result.remaining}`);
            return result;
        } else {
            console.error(`❌ Failed to scrape year ${year}:`, result.message);
            return result;
        }
    }

    async processQueue(batchSize = 5) {
        console.log(`\n⚙️ Processing queue (batch size: ${batchSize})...`);
        
        const result = await this.apiCall('/api/queue-processor', {
            action: 'process',
            batchSize
        }, 'POST');

        if (result.success) {
            console.log(`✅ Processed ${result.processed}/${result.total} documents`);
        } else {
            console.error(`❌ Queue processing failed:`, result.message);
        }
        
        return result;
    }

    async embedQueue(batchSize = 3) {
        console.log(`\n🧠 Embedding queue (batch size: ${batchSize})...`);
        
        const result = await this.apiCall('/api/queue-processor', {
            action: 'embed',
            batchSize
        }, 'POST');

        if (result.success) {
            console.log(`✅ Embedded ${result.embedded}/${result.total} documents`);
        } else {
            console.error(`❌ Queue embedding failed:`, result.message);
        }
        
        return result;
    }

    async processCompleteYear(year, maxIterations = 20) {
        console.log(`\n📅 Complete processing for year ${year}`);
        
        // Step 1: Initial scrape
        let scrapeResult = await this.scrapeYear(year);
        if (!scrapeResult.success) return false;

        let iteration = 0;
        let remainingDocs = scrapeResult.remaining || 0;

        // Step 2: Continue scraping remaining documents
        while (remainingDocs > 0 && iteration < maxIterations) {
            iteration++;
            console.log(`\n🔄 Iteration ${iteration}: ${remainingDocs} documents remaining`);
            
            await this.delay(2000); // Wait between iterations
            
            scrapeResult = await this.scrapeYear(year);
            if (!scrapeResult.success) break;
            
            remainingDocs = scrapeResult.remaining || 0;
        }

        // Step 3: Process all scraped documents
        let processResult;
        do {
            await this.delay(1000);
            processResult = await this.processQueue(5);
        } while (processResult.success && processResult.processed > 0);

        // Step 4: Embed all processed documents  
        let embedResult;
        do {
            await this.delay(2000); // Longer delay for embeddings
            embedResult = await this.embedQueue(3);
        } while (embedResult.success && embedResult.embedded > 0);

        // Step 5: Final stats
        await this.getStats();
        console.log(`\n✅ Year ${year} complete!`);
        
        return true;
    }

    async processMultipleYears(startYear, endYear) {
        console.log(`\n🎯 Processing years ${startYear} to ${endYear}`);
        
        for (let year = startYear; year >= endYear; year--) {
            const success = await this.processCompleteYear(year);
            if (!success) {
                console.error(`❌ Failed to complete year ${year}, stopping.`);
                break;
            }
            
            // Longer break between years
            if (year > endYear) {
                console.log(`\n⏸️ Waiting 30 seconds before next year...`);
                await this.delay(30000);
            }
        }
        
        await this.getStats();
        this.logFinalReport();
    }

    logStats() {
        const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000 / 60);
        console.log(`\n📊 Current Stats (${runtime}min runtime):`);
        console.log(`   Total Documents: ${this.stats.totalDocuments}`);
        console.log(`   Processed: ${this.stats.processedDocuments} (${this.stats.completionRate || 0}%)`);
        console.log(`   Embedded: ${this.stats.embeddedDocuments}`);
        if (this.stats.currentYear) {
            console.log(`   Current Year: ${this.stats.currentYear}`);
        }
    }

    logFinalReport() {
        const totalTime = Math.floor((Date.now() - this.stats.startTime) / 1000 / 60);
        console.log(`\n🎉 FINAL REPORT`);
        console.log(`   Total Runtime: ${totalTime} minutes`);
        console.log(`   Documents Processed: ${this.stats.processedDocuments}`);
        console.log(`   Documents Embedded: ${this.stats.embeddedDocuments}`);
        console.log(`   Average: ${Math.round(this.stats.processedDocuments / Math.max(totalTime, 1))} docs/min`);
    }
}

// Usage examples:
async function main() {
    const scraper = new GazzettaScraper();
    
    // Get initial stats
    await scraper.getStats();
    
    // Option 1: Process just 2024
    // await scraper.processCompleteYear(2024);
    
    // Option 2: Process recent years (2024-2020)
    // await scraper.processMultipleYears(2024, 2020);
    
    // Option 3: Process everything (will take days!)
    // await scraper.processMultipleYears(2024, 1986);
    
    console.log('Automation script ready. Uncomment desired option in main() function.');
}

// Export for use
if (typeof module !== 'undefined') {
    module.exports = { GazzettaScraper };
} else if (typeof window !== 'undefined') {
    window.GazzettaScraper = GazzettaScraper;
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
    main().catch(console.error);
}