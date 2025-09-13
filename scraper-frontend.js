// UrbanAI Frontend Scraper - Direct Implementation
class UrbanAIDirectScraper {
    constructor() {
        this.baseUrl = 'https://www.gazzettaufficiale.it';
        this.stats = {
            found: 0,
            processed: 0,
            errors: 0
        };
    }

    async findPDFsForYear(year) {
        try {
            console.log(`🔍 Searching PDFs for year ${year}...`);
            
            // Use a CORS proxy to access Gazzetta Ufficiale
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
                `${this.baseUrl}/ricerca/regioni/risultati`
            )}`;
            
            const formData = new URLSearchParams();
            formData.append('anno', year.toString());
            formData.append('submit', 'Cerca');
            
            const response = await fetch(proxyUrl, {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            const htmlContent = result.contents;
            
            // Extract PDF URLs using DOM parser
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            
            const pdfLinks = [];
            const links = doc.querySelectorAll('a[href*=".pdf"]');
            
            links.forEach(link => {
                let href = link.getAttribute('href');
                if (href) {
                    if (href.startsWith('/')) {
                        href = this.baseUrl + href;
                    }
                    pdfLinks.push({
                        url: href,
                        title: link.textContent?.trim() || 'PDF Document',
                        year: year
                    });
                }
            });
            
            // Remove duplicates
            const uniquePDFs = pdfLinks.filter((pdf, index, self) =>
                index === self.findIndex(p => p.url === pdf.url)
            );
            
            this.stats.found = uniquePDFs.length;
            console.log(`✅ Found ${uniquePDFs.length} PDFs for year ${year}`);
            
            return uniquePDFs;
            
        } catch (error) {
            console.error('Error finding PDFs:', error);
            this.stats.errors++;
            return [];
        }
    }

    async processPDFBatch(pdfs, batchSize = 5) {
        console.log(`⚙️ Processing ${pdfs.length} PDFs in batches of ${batchSize}...`);
        
        for (let i = 0; i < pdfs.length; i += batchSize) {
            const batch = pdfs.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pdfs.length/batchSize)}`);
            
            // Process batch concurrently but with limit
            const promises = batch.map(pdf => this.processSinglePDF(pdf));
            await Promise.allSettled(promises);
            
            // Small delay between batches
            await this.delay(1000);
        }
    }

    async processSinglePDF(pdf) {
        try {
            console.log(`📄 Processing: ${pdf.title}`);
            
            // For now, we'll collect metadata and URLs
            // In a real implementation, you'd download and process the PDF
            const processedPDF = {
                ...pdf,
                processed: true,
                processedAt: new Date().toISOString(),
                status: 'metadata_collected'
            };
            
            this.stats.processed++;
            
            // Store in localStorage for now (would be MongoDB in real implementation)
            this.storePDFMetadata(processedPDF);
            
            return processedPDF;
            
        } catch (error) {
            console.error(`Error processing ${pdf.title}:`, error);
            this.stats.errors++;
            return null;
        }
    }

    storePDFMetadata(pdf) {
        try {
            const stored = JSON.parse(localStorage.getItem('urbanai_pdfs') || '[]');
            
            // Check if already exists
            if (!stored.find(p => p.url === pdf.url)) {
                stored.push(pdf);
                localStorage.setItem('urbanai_pdfs', JSON.stringify(stored));
                console.log(`💾 Stored metadata for: ${pdf.title}`);
            }
        } catch (error) {
            console.error('Error storing PDF metadata:', error);
        }
    }

    getStoredPDFs() {
        try {
            return JSON.parse(localStorage.getItem('urbanai_pdfs') || '[]');
        } catch {
            return [];
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    logStats() {
        console.log(`\n📊 Scraping Stats:`);
        console.log(`   Found: ${this.stats.found} PDFs`);
        console.log(`   Processed: ${this.stats.processed} PDFs`);
        console.log(`   Errors: ${this.stats.errors}`);
        console.log(`   Stored: ${this.getStoredPDFs().length} PDFs`);
    }

    // Main scraping function
    async scrapeYear(year) {
        console.log(`\n🚀 Starting scrape for year ${year}`);
        
        const pdfs = await this.findPDFsForYear(year);
        
        if (pdfs.length === 0) {
            console.log(`❌ No PDFs found for year ${year}`);
            return;
        }
        
        await this.processPDFBatch(pdfs.slice(0, 10)); // Process first 10 for testing
        
        this.logStats();
        
        return {
            year: year,
            found: pdfs.length,
            processed: this.stats.processed,
            pdfs: pdfs
        };
    }
}

// Usage
console.log('🎯 UrbanAI Direct Scraper Ready!');
console.log('Usage:');
console.log('const scraper = new UrbanAIDirectScraper();');
console.log('scraper.scrapeYear(2024);');

// Make available globally
window.UrbanAIDirectScraper = UrbanAIDirectScraper;