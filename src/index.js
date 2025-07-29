// High-confidence index.js with robust pageId extraction and table manipulation

import api, { route } from '@forge/api';
import { parse } from 'node-html-parser';

// Helper: clean text by removing non-breaking spaces and trimming
const clean = (str = '') => str?.replace(/\u00A0/g, '')?.trim() || '';

// Robust pageId extraction based on Forge/Rovo patterns
const extractPageId = (event, context) => {
  console.log('=== PAGE ID EXTRACTION DEBUG ===');
  console.log('Event structure:', JSON.stringify(event, null, 2));
  console.log('Context structure:', JSON.stringify(context, null, 2));
  
  // Rovo agents: pageId comes through multiple possible paths
  const candidates = [
    // Most common for Rovo actions - the input parameter from manifest
    event?.input?.pageId,
    
    // Alternative Rovo patterns
    event?.pageId,
    event?.contentId,
    
    // Context-based patterns (from Confluence context)
    context?.contentId,
    context?.extension?.content?.id,
    context?.cloudId,
    
    // From payload (action context)
    event?.payload?.contentId,
    event?.payload?.pageId,
    
    // URL-based extraction if full URL is provided
    ...[event?.input?.pageId, event?.pageId, context?.contentId].map(val => {
      if (typeof val === 'string' && val.includes('/pages/')) {
        const match = val.match(/\/pages\/(\d+)/);
        return match ? match[1] : null;
      }
      return null;
    }).filter(Boolean),

    // Possible explicit URL fields
    event?.input?.url,
    event?.url,
  ];
  
  // Find first valid pageId
  for (const candidate of candidates) {
    if (!candidate) continue;
    
    // Check if it's a valid numeric page ID
    const pageId = String(candidate).trim();
    if (/^\d+$/.test(pageId)) {
      console.log(`✓ Found valid pageId: ${pageId}`);
      return pageId;
    }
  }
  
  console.log('✗ No valid pageId found');
  return null;
};

// ---------------------------------------------------------------------------
// Fallback: query Confluence to auto‑detect a pageId by title if extraction fails
// ---------------------------------------------------------------------------
const autoDetectPageIdByTitle = async (title, apiInstance, runId) => {
  if (!title) return null;

  try {
    console.log(`[${runId}] Attempting auto‑detection via search: "${title}"`);
    // Use CQL search (v2) to find pages whose title matches exactly
    const searchResponse = await apiInstance.requestConfluence(
      route`/wiki/api/v2/search?cql=type=page AND title~"${encodeURIComponent(title)}"&limit=1`
    );

    if (!searchResponse.ok) {
      console.warn(
        `[${runId}] Search request failed: ${searchResponse.status}`
      );
      return null;
    }

    const searchResults = await searchResponse.json();
    const result = searchResults?.results?.[0];

    if (result?.content?.id) {
      console.log(
        `[${runId}] Auto‑detected pageId ${result.content.id} from search`
      );
      return String(result.content.id);
    }

    console.log(`[${runId}] No matching pages found via search`);
    return null;
  } catch (err) {
    console.warn(`[${runId}] Auto‑detect failed: ${err.message}`);
    return null;
  }
};

// Robust table cell manipulation with proper DOM handling
const ensureTableStructure = (table, requiredColumns) => {
  const rows = table.querySelectorAll('tr');
  if (rows.length === 0) return null;
  
  const headerRow = rows[0];
  let headerCells = headerRow.querySelectorAll('th');
  
  // If no th elements, try td elements (some tables use td for headers)
  if (headerCells.length === 0) {
    headerCells = headerRow.querySelectorAll('td');
  }
  
  if (headerCells.length === 0) return null;
  
  // Get current headers
  const headers = Array.from(headerCells).map(cell => clean(cell.text).toLowerCase());
  console.log('Current headers:', headers);
  
  // Add missing headers
  const missingHeaders = requiredColumns.filter(col => 
    !headers.some(h => h.includes(col.toLowerCase()))
  );
  
  if (missingHeaders.length > 0) {
    console.log('Adding missing headers:', missingHeaders);
    
    for (const header of missingHeaders) {
      // Create new header cell
      const newHeader = parse(`<th>${header}</th>`);
      headerRow.appendChild(newHeader.firstChild);
      headers.push(header.toLowerCase());
    }
    
    // Ensure all data rows have matching number of cells
    const dataRows = Array.from(rows).slice(1);
    for (const row of dataRows) {
      const cells = row.querySelectorAll('td');
      const cellsNeeded = headers.length - cells.length;
      
      for (let i = 0; i < cellsNeeded; i++) {
        const newCell = parse('<td></td>');
        row.appendChild(newCell.firstChild);
      }
    }
  }
  
  return {
    headers,
    headerRow,
    dataRows: Array.from(rows).slice(1)
  };
};

// Simple but effective keyword-based classification
const classifyFeedback = (subject, description) => {
  const text = (subject + ' ' + description).toLowerCase();
  
  // Default classification
  let theme = 'Other';
  let impact = 'Medium';
  
  // Bug-related keywords
  if (text.match(/\b(bug|error|broken|fail|crash|issue|problem|not work)\b/)) {
    theme = 'Bug Report';
    impact = 'High';
  }
  // Feature requests
  else if (text.match(/\b(feature|enhancement|request|add|new|improve|want|need)\b/)) {
    theme = 'Feature Request';
    impact = 'Medium';
  }
  // Performance issues
  else if (text.match(/\b(slow|performance|timeout|lag|speed|fast|optimize)\b/)) {
    theme = 'Performance';
    impact = 'High';
  }
  // UI/UX issues
  else if (text.match(/\b(ui|interface|usability|confusing|difficult|design|layout)\b/)) {
    theme = 'Usability';
    impact = 'Medium';
  }
  // Integration issues
  else if (text.match(/\b(integration|api|connection|sync|external|third.party)\b/)) {
    theme = 'Integration';
    impact = 'Medium';
  }
  
  return { theme, impact };
};

export async function main(event, context) {
  const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  
  try {
    console.log(`[${runId}] === PM FEEDBACK AGENT START ===`);
    
    // ROBUST pageId extraction with comprehensive debugging
    let pageId = extractPageId(event, context);
    
    if (!pageId) {
      console.log(
        `[${runId}] extractPageId failed – attempting server‑side auto‑detection`
      );

      // Try to derive the pageId from the page title via search
      const fallbackPageId = await autoDetectPageIdByTitle(
        context?.content?.title,
        api.asApp(),
        runId
      );

      if (fallbackPageId) {
        console.log(
          `[${runId}] Fallback succeeded; using auto‑detected pageId ${fallbackPageId}`
        );
        pageId = fallbackPageId;
      } else {
        console.error(
          `[${runId}] CRITICAL: Unable to determine pageId automatically`
        );
        return {
          statusCode: 400,
          body: {
            error: 'pageId is required but could not be determined automatically',
            debug: {
              eventKeys: Object.keys(event || {}),
              contextKeys: Object.keys(context || {}),
              runId
            }
          }
        };
      }
    }
    
    console.log(`[${runId}] Successfully extracted pageId: ${pageId}`);

    // Fetch page content using the correct v2 API endpoint
    console.log(`[${runId}] Fetching page content...`);
    const response = await api.asApp().requestConfluence(
      route`/wiki/api/v2/pages/${pageId}?body-format=storage`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${runId}] Page fetch failed: ${response.status} - ${errorText}`);
      
      return { 
        statusCode: response.status, 
        body: { 
          error: `Failed to fetch page: ${response.status}`,
          details: errorText,
          runId
        } 
      };
    }

    const pageData = await response.json();
    const { title, version, body } = pageData;
    const html = body.storage.value;
    
    console.log(`[${runId}] Page fetched: "${title}" (version ${version.number})`);
    console.log(`[${runId}] HTML content length: ${html.length} characters`);

    // Parse HTML and find table with robust error handling
    const root = parse(html);
    const table = root.querySelector('table');

    if (!table) {
      console.log(`[${runId}] No table found on page - this is normal if page has no tables`);
      return { 
        statusCode: 200, 
        body: { 
          message: 'No table found on this page to process',
          runId
        } 
      };
    }

    console.log(`[${runId}] Table found, processing structure...`);

    // ROBUST table structure handling
    const tableStructure = ensureTableStructure(table, ['Theme', 'Impact']);
    
    if (!tableStructure) {
      console.error(`[${runId}] Invalid table structure - no valid headers found`);
      return { 
        statusCode: 400, 
        body: { 
          error: 'Table has invalid structure - no headers found',
          runId
        } 
      };
    }

    const { headers, dataRows } = tableStructure;
    console.log(`[${runId}] Table structure validated. Headers: [${headers.join(', ')}]`);
    console.log(`[${runId}] Found ${dataRows.length} data rows to process`);

    // Find required column indices with flexible matching
    const findColumnIndex = (columnName) => {
      return headers.findIndex(h => h.includes(columnName.toLowerCase()));
    };

    const subjectIndex = findColumnIndex('subject');
    const descriptionIndex = findColumnIndex('description');
    const themeIndex = findColumnIndex('theme');
    const impactIndex = findColumnIndex('impact');

    console.log(`[${runId}] Column mapping: Subject=${subjectIndex}, Description=${descriptionIndex}, Theme=${themeIndex}, Impact=${impactIndex}`);

    if (subjectIndex === -1 || descriptionIndex === -1) {
      console.error(`[${runId}] Required columns missing - need 'subject' and 'description'`);
      return { 
        statusCode: 400, 
        body: { 
          error: 'Table must contain "subject" and "description" columns',
          foundHeaders: headers,
          runId
        } 
      };
    }

    if (themeIndex === -1 || impactIndex === -1) {
      console.error(`[${runId}] Theme or Impact columns missing after structure update`);
      return { 
        statusCode: 500, 
        body: { 
          error: 'Failed to add required Theme/Impact columns',
          runId
        } 
      };
    }

    // Process each data row with robust cell handling
    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const cells = row.querySelectorAll('td');
      
      // Ensure we have enough cells (should be handled by ensureTableStructure but double-check)
      if (cells.length < headers.length) {
        console.warn(`[${runId}] Row ${i + 1}: Insufficient cells (${cells.length}), skipping`);
        skippedCount++;
        continue;
      }
      
      // Extract current values
      const subject = clean(cells[subjectIndex]?.text);
      const description = clean(cells[descriptionIndex]?.text);
      const currentTheme = clean(cells[themeIndex]?.text);
      const currentImpact = clean(cells[impactIndex]?.text);

      console.log(`[${runId}] Row ${i + 1}: "${subject}" | "${description}" | Theme: "${currentTheme}" | Impact: "${currentImpact}"`);

      // Skip empty rows
      if (!subject && !description) {
        console.log(`[${runId}] Row ${i + 1}: Empty row, skipping`);
        skippedCount++;
        continue;
      }

      // Skip already labeled rows
      if (currentTheme && currentImpact) {
        console.log(`[${runId}] Row ${i + 1}: Already labeled, skipping`);
        skippedCount++;
        continue;
      }

      // Classify the feedback
      const { theme, impact } = classifyFeedback(subject, description);
      console.log(`[${runId}] Row ${i + 1}: Classified as ${theme}/${impact}`);
      
      // Update cells if they're empty
      let rowUpdated = false;
      
      if (!currentTheme) {
        cells[themeIndex].innerHTML = theme;
        console.log(`[${runId}] Row ${i + 1}: Set Theme to "${theme}"`);
        rowUpdated = true;
      }
      
      if (!currentImpact) {
        cells[impactIndex].innerHTML = impact;
        console.log(`[${runId}] Row ${i + 1}: Set Impact to "${impact}"`);
        rowUpdated = true;
      }
      
      if (rowUpdated) {
        updatedCount++;
      }
    }

    console.log(`[${runId}] Processing complete: ${updatedCount} rows updated, ${skippedCount} rows skipped`);

    // Update page only if we made changes
    if (updatedCount > 0) {
      console.log(`[${runId}] Updating page content...`);
      
      const updatedHtml = root.toString();
      
      // Use the correct v2 API endpoint for updating pages
      const updateResponse = await api.asApp().requestConfluence(
        route`/wiki/api/v2/pages/${pageId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: pageId,
            status: 'current',
            title,
            body: {
              storage: {
                value: updatedHtml,
                representation: 'storage'
              }
            },
            version: {
              number: version.number + 1,
              message: `PM Feedback Agent: Labeled ${updatedCount} feedback items (${runId})`
            }
          })
        }
      );

      if (!updateResponse.ok) {
        const updateError = await updateResponse.text();
        console.error(`[${runId}] Page update failed: ${updateResponse.status} - ${updateError}`);
        
        return { 
          statusCode: updateResponse.status, 
          body: { 
            error: 'Failed to update page content',
            details: updateError,
            runId
          } 
        };
      }

      console.log(`[${runId}] Page updated successfully`);

      // Add completion comment using v2 API (non-critical)
      try {
        await api.asApp().requestConfluence(
          route`/wiki/api/v2/pages/${pageId}/comments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              body: {
                storage: {
                  value: `<p>✅ PM Feedback Agent completed: ${updatedCount} rows labeled (${runId})</p>`,
                  representation: 'storage'
                }
              }
            })
          }
        );
        console.log(`[${runId}] Completion comment added`);
      } catch (commentError) {
        // Comment failure is non-critical
        console.log(`[${runId}] Comment failed (non-critical): ${commentError.message}`);
      }
    } else {
      console.log(`[${runId}] No updates needed - all rows already processed`);
    }

    console.log(`[${runId}] === AGENT COMPLETED SUCCESSFULLY ===`);
    
    return {
      statusCode: 200,
      body: { 
        message: `Feedback labeling completed: ${updatedCount} rows updated, ${skippedCount} rows skipped`,
        summary: {
          totalRows: dataRows.length,
          updated: updatedCount,
          skipped: skippedCount,
          pageTitle: title
        },
        runId
      }
    };

  } catch (error) {
    console.error(`[${runId}] === AGENT FAILED ===`);
    console.error(`[${runId}] Error: ${error.message}`);
    console.error(`[${runId}] Stack: ${error.stack}`);
    
    return {
      statusCode: 500,
      body: { 
        error: 'Unexpected error during processing',
        details: error.message,
        runId
      }
    };
  }
}