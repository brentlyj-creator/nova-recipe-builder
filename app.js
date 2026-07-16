
        // --- Database Arrays ---
        let propertyDatabase = ["Hotel Alpha", "Hotel Beta", "Hotel Gamma"];
        let categoryDatabase = ["Food", "Liquor", "Wine", "Beer"];
        let supplierDatabase = ["Sysco", "GFS", "Local Market"];
        let packTypeDatabase = ['Case', 'Bag', 'Bottle', 'Jug', 'Each', 'Keg', 'Container']; // Global received-as pack types
        let unitDescriptorDatabase = ['Unit', 'Bag', 'Box', 'Sleeve', 'Tray', 'Portion']; // Global unit-per-pack descriptors
        
        let itemDatabase = []; // Global
        let prepDatabase = []; // Localized (has .property key)
        let menuDatabase = []; // Localized (has .property key)
        let propertyMenuDatabase = []; // Localized operational menus by property
        
        let currentProperty = propertyDatabase[0];
		let menuItemCategoryDatabase = ['Appies', 'Salads', 'Entrees', 'LWB'];
		let prepCategoryDatabase = [];
        let inventoryCountDatabase = {}; // { [property]: { [itemId]: { opening:{cases,packQty}, closing:{cases,packQty}, purchases:[{cases,packQty}] } } }
        let varianceCalcCache = {}; // { [property]: { [itemId]: {theoreticalQty, actualQty, varianceQty, varianceCost, costPerUnit} } }
        let varianceLastCalculated = {}; // { [property]: ISOStringDate of last Calculate Variance click }
        let lastRenderedVarianceRows = []; // Mirrors exactly what's on screen (after search + sort) so Export Report matches it
        let currentPrepIngredients = [];
        let currentMenuIngredients = [];
        let currentEditMenuModalIngredients = [];
        let activeModalTarget = ''; 
        let duplicateTargetId = null;
        let duplicateTargetType = null;
        let selectedMenuId = null;

        let itemCurrentPage = 1;
        const ITEMS_PER_PAGE = 100;
        const APP_VERSION = '16.0';
        const APP_STORAGE_KEY = `fb_recipe_cogs_manager_v${APP_VERSION.replace('.', '_')}`;
        const LEGACY_STORAGE_KEYS = ['fb_recipe_cogs_manager_v15', 'fb_recipe_cogs_manager_v15_0'];

        // --- PROPERTY & CATEGORY MANAGEMENT LOGIC ---
                   function initSettings() {
            updatePropertyDropdowns();
            renderPropertyTable();
            updateUIPropertyNames();
            renderCategoryTable();
            renderSupplierTable();
            renderPackTypeTable();
            renderUnitDescriptorTable();
            renderMenuItemCategoryTable();
            reconcilePrepCategories();
            renderPrepCategoryTable();
            renderPropertyMenuPicker();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
        }

        function generateId(prefix) {
            return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        }

        // --- SMOOTHNESS / SAFETY HELPERS ---
        function showToast(message, type = 'info') {
            const toast = document.getElementById('toast');
            if (!toast) return;
            const colors = { info: '#2c3e50', success: '#18bc9c', warning: '#f39c12', error: '#e74c3c' };
            toast.textContent = message;
            toast.style.background = colors[type] || colors.info;
            toast.style.display = 'block';
            clearTimeout(showToast._timer);
            showToast._timer = setTimeout(() => { toast.style.display = 'none'; }, 2600);
        }
        function setSaveStatus(text, color = '#aaa') { const el=document.getElementById('saveStatus'); if(!el)return; const label=el.querySelector('.sidebar-label'); if(label)label.textContent=text; else el.textContent=text; el.style.color=color; const dot=el.querySelector('.save-status-dot'); if(dot)dot.style.background=color; }
        function markDirty() { setSaveStatus('Unsaved changes', '#f39c12'); }
        function markClean() { setSaveStatus('Saved', '#18bc9c'); }
        function debounce(fn, delay = 200) { let timer; return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); }; }
        function escapeHtml(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
        function plainText(value) { return String(value ?? '').replace(/[<>]/g, '').trim(); }
        function decodeHtmlEntities(value) { const textarea = document.createElement('textarea'); textarea.innerHTML = String(value ?? ''); return textarea.value; }
        function cleanRichText(html) { const allowedTags = ['B','I','U','UL','OL','LI','P','BR','STRONG','EM','DIV']; 
			const template = document.createElement('template'); 
			template.innerHTML = String(html || '').replace(/&nbsp;/gi, ' '); 
		    template.content.querySelectorAll('*').forEach(node => { if (!allowedTags.includes(node.tagName)) { node.replaceWith(document.createTextNode(node.textContent || '')); 
		    return; } [...node.attributes].forEach(attr => { if (node.tagName === 'OL' && attr.name === 'type') 
			return; node.removeAttribute(attr.name); }); }); return template.innerHTML; }
        function richTextToPlainText(html, { dedupeAdjacentLines = true } = {}) {
            const template = document.createElement('template');
            template.innerHTML = String(html || '').replace(/&amp;nbsp;/gi, '&nbsp;');
            template.content.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
            template.content.querySelectorAll('p, div, li').forEach(el => el.appendChild(document.createTextNode('\n')));
            let text = template.content.textContent || '';
            for (let i = 0; i < 3; i++) { const decoded = decodeHtmlEntities(text); if (decoded === text) break; text = decoded; }
            text = text.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();
            if (!dedupeAdjacentLines) return text;
            const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
            const cleaned = [];
            lines.forEach(line => { if (cleaned[cleaned.length - 1] !== line) cleaned.push(line); });
            return cleaned.join('\n');
        }
        function sanitizePlainTextFields(records, fields) {
            if (!Array.isArray(records)) return [];
            return records.map(record => { if (!record || typeof record !== 'object') return record; fields.forEach(field => { if (record[field] !== undefined && record[field] !== null) record[field] = plainText(record[field]); }); return record; });
        }
        function syncItemNameInRecipes(itemId, newName) {
            if (!itemId || !newName) return 0;
            let updated = 0;
            const syncList = (ingredients) => {
                if (!Array.isArray(ingredients)) return;
                ingredients.forEach(ing => {
                    if (ing && ing.type === 'raw' && ing.itemId === itemId && ing.name !== newName) {
                        ing.name = newName;
                        updated++;
                    }
                });
            };
            prepDatabase.forEach(recipe => syncList(recipe.ingredients));
            menuDatabase.forEach(recipe => syncList(recipe.ingredients));
            syncList(currentPrepIngredients);
            syncList(currentMenuIngredients);
            return updated;
        }
        function syncAllItemNamesInRecipes() {
            if (!Array.isArray(itemDatabase)) return 0;
            return itemDatabase.reduce((count, item) => count + syncItemNameInRecipes(item.id, item.name), 0);
        }


        function getCurrentPropertyMenus() {
            return propertyMenuDatabase.filter(m => m.property === currentProperty);
        }

        function getSelectedPropertyMenu() {
            const selected = propertyMenuDatabase.find(m => m.id === selectedMenuId && m.property === currentProperty);
            if (selected) return selected;

            const currentMenus = getCurrentPropertyMenus();
            if (currentMenus.length > 0) {
                selectedMenuId = currentMenus[0].id;
                return currentMenus[0];
            }

            selectedMenuId = null;
            return null;
        }

        function printMenuReport() {
            const menu = getSelectedPropertyMenu();
            if (!menu) { alert('Please select a menu first.'); return; }

            const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            let categorySections = '';
            menu.categories.forEach(category => {
                const totals = calculateCategoryTotals(category);
                let rows = '';
                getSortedCategoryItems(category).forEach(line => {
                    const calc = calculateMenuLine(line);
                    if (!calc) return;
                    const costColor = calc.theoreticalPct > 35 ? '#e74c3c' : calc.theoreticalPct >= 30 ? '#f39c12' : '#18bc9c';
                    rows += `
                        <tr>
                            <td>${calc.recipe.name}</td>
                            <td>$${calc.cost.toFixed(2)}</td>
                            <td>$${calc.price.toFixed(2)}</td>
                            <td style="color:${costColor}; font-weight:bold;">${calc.theoreticalPct.toFixed(1)}%</td>
                            <td>${calc.soldQty}</td>
                            <td>$${calc.sales.toFixed(2)}</td>
                            <td>$${calc.theoreticalCost.toFixed(2)}</td>
                        </tr>`;
                });
                if (!rows) return;
                const catPct = totals.theoreticalPct;
                const catColor = catPct > 35 ? '#e74c3c' : catPct >= 30 ? '#f39c12' : '#18bc9c';
                categorySections += `
                    <tr class="cat-header"><td colspan="7">${category.name}</td></tr>
                    ${rows}
                    <tr class="cat-total">
                        <td colspan="3" style="text-align:right;">Category Totals:</td>
                        <td style="color:${catColor}; font-weight:bold;">${catPct.toFixed(1)}%</td>
                        <td></td>
                        <td>$${totals.sales.toFixed(2)}</td>
                        <td>$${totals.cost.toFixed(2)}</td>
                    </tr>`;
            });

            const grandTotals = calculateMenuTotals(menu);
            const grandColor = grandTotals.theoreticalPct > 35 ? '#e74c3c' : grandTotals.theoreticalPct >= 30 ? '#f39c12' : '#18bc9c';

            const html = `<!DOCTYPE html>
            <html><head><meta charset="UTF-8">
            <title>${currentProperty} — ${menu.name}</title>
            <style>
                body { font-family: 'Segoe UI', sans-serif; margin: 30px; color: #333; }
                h1 { font-size: 1.4rem; margin-bottom: 2px; }
                .subtitle { font-size: 0.9rem; color: #666; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
                th { background: #2c3e50; color: white; padding: 8px 10px; text-align: left; }
                td { padding: 7px 10px; border-bottom: 1px solid #dee2e6; }
                tr.cat-header td { background: #18bc9c; color: white; font-weight: bold; font-size: 0.95rem; padding: 8px 10px; }
                tr.cat-total td { background: #f0f0f0; font-weight: bold; }
                tr.grand-total td { background: #2c3e50; color: white; font-weight: bold; padding: 9px 10px; }
                tr:hover { background: #f9f9f9; }
                @media print {
                    body { margin: 15px; }
                    button { display: none; }
                }
            </style>
            </head><body>
            <h1>${currentProperty} — ${menu.name}</h1>
            <div class="subtitle">Generated: ${date}</div>
            <table>
                <thead>
                    <tr>
                        <th>Menu Item</th>
                        <th>Food Cost ($)</th>
                        <th>Sell Price ($)</th>
                        <th>Cost %</th>
                        <th>Sales Qty</th>
                        <th>Total Sales ($)</th>
                        <th>Theo Cost ($)</th>
                    </tr>
                </thead>
                <tbody>
                    ${categorySections}
                    <tr class="grand-total">
                        <td colspan="3" style="text-align:right;">GRAND TOTAL</td>
                        <td style="color:${grandColor === '#2c3e50' ? 'white' : grandColor};">${grandTotals.theoreticalPct.toFixed(1)}%</td>
                        <td></td>
                        <td>$${grandTotals.sales.toFixed(2)}</td>
                        <td>$${grandTotals.cost.toFixed(2)}</td>
                    </tr>
                </tbody>
            </table>
            <script>window.onload = function() { setTimeout(function(){ window.print(); }, 100); }; window.onafterprint = function(){ setTimeout(function(){ window.close(); }, 150); };<\/script>
            </body></html>`;

            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
            // No main-page re-render here; this keeps menu sorting and drag/drop responsive after printing.
        }
		
		        const HACCP_TEXT = `<strong>HACCP:</strong> Measure all temperatures with a cleaned and sanitized thermometer. Wash hands before handling food, after handling raw foods, and after any activity that may contaminate hands. Wash, rinse, and sanitize all equipment and utensils before and after use. Return all ingredients to refrigerated storage if preparation is delayed or interrupted. Heat any product needed to an internal temperature reaches 165°F CCP-1, transfer into an appropriate container and cool to 45°F CCP-2 then cover, label and refrigerate below 40°F CCP-3.`;

        function buildPrepRecipeCardHTML(recipe) {
            const shelfLife = recipe.shelfLife ? `${recipe.shelfLife} Days` : '? Days';
            const compactYieldUnits = ['L', 'ML', 'KG', 'G', 'LBS', 'OZ'];
            const yieldAmount = recipe.yieldAmount ?? '?';
            const yieldUnit = recipe.yieldUnit || '';
            const yieldDisplay = `${yieldAmount}${compactYieldUnits.includes(yieldUnit) ? '' : ' '}${yieldUnit}`.trim();

            const ingredientList = recipe.ingredients && recipe.ingredients.length > 0
                ? recipe.ingredients.map(ing => `<li>${ing.qty} ${ing.unit} — ${ing.name}</li>`).join('')
                : '<li>No ingredients listed.</li>';

            const steps = recipe.steps && recipe.steps.trim() !== ''
                ? recipe.steps
                : '<p>No preparation steps listed.</p>';

            return `
                <div class="recipe-card">
                    <div class="card-left">
                        <div class="section-label">INGREDIENTS</div>
                        <ul class="ingredient-list">${ingredientList}</ul>
                        <div class="meta-block">
                            <div><em><strong>Yield: ${yieldDisplay}</strong></em></div>
                            <div><em><strong>Shelf Life: ${shelfLife}</strong></em></div>
                        </div>
                    </div>
                    <div class="card-divider"></div>
                                      <div class="card-right">
                        <h1 class="recipe-title">${recipe.name}</h1>
                        <div class="section-label">PREPARATION</div>
                        <div class="prep-steps">${steps}</div>
                        <div class="hccap">${HACCP_TEXT}</div>
                    </div>
                </div>`;
        }

              function getPrepCardStyles() {
            return `
                @page { size: landscape; margin: 0; }
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body { font-family: 'Century Gothic', CenturyGothic, AppleGothic, sans-serif; background: #ffffff; color: #1a1a1a; }
                .recipe-card {
                    display: flex;
                    min-height: 100vh;
                    page-break-after: always;
                    background: #ffffff;
                }
                .card-left {
                    width: 300px;
                    min-width: 300px;
                    padding: 40px 30px 40px 40px;
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }
                .card-divider {
                    width: 1px;
                    background: #ccc;
                    margin: 40px 0;
                }
                .card-right {
                    flex: 1;
                    padding: 30px 50px 40px 40px;
                    display: flex;
                    flex-direction: column;
                }
                .section-label {
                    font-size: 0.72rem;
                    font-weight: 900;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    margin-bottom: 8px;
                    font-family: 'Century Gothic', CenturyGothic, AppleGothic, sans-serif;
                }
                .recipe-title {
                    font-size: 3.8rem;
                    font-weight: 900;
                    font-style: italic;
                    line-height: 1.05;
                    margin-top: 0;
                    margin-bottom: 16px;
                    font-family: 'Century Gothic', CenturyGothic, AppleGothic, sans-serif;
                }
                .ingredient-list {
                    list-style: disc;
                    padding-left: 18px;
                    font-size: 0.9rem;
                    line-height: 1.9;
                }
                .meta-block {
                    font-size: 0.9rem;
                    line-height: 1.8;
                    margin-top: 6px;
                }
                .prep-steps {
                    font-size: 0.92rem;
                    line-height: 1.7;
                    flex: 1;
                    margin-bottom: 20px;
                }
                .prep-steps p { margin: 0 0 6px 0; }
                .prep-steps ul {
                    list-style: disc;
                    padding-left: 20px;
                    margin: 6px 0;
                }
                .prep-steps ol {
                    list-style: decimal;
                    padding-left: 20px;
                    margin: 6px 0;
                }
                .prep-steps li { margin: 4px 0; display: list-item; }
                .hccap {
                    font-size: 0.75rem;
                    line-height: 1.6;
                    color: #333;
                    border-top: 1px solid #ccc;
                    padding-top: 14px;
                    margin-top: auto;
                    align-self: flex-end;
                    width: 100%;
                }
                @media print {
                    body { background: white; }
                    .recipe-card { background: white; min-height: 100vh; }
                }`;
        }
               
        function printSinglePrepRecipe(recipeId) {
            const recipe = getPrepForExport(recipeId);
            if (!recipe) return;
            const w = window.open('', '_blank');
            w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
                <title>${recipe.name}</title>
                <style>${getPrepCardStyles()}</style>
                </head><body>
                ${buildPrepRecipeCardHTML(recipe)}
                <script>window.onload = function(){ window.print(); }<\/script>
                </body></html>`);
            w.document.close();
        }

        function printAllPrepRecipes() {
            syncCurrentPrepEditBeforeExport();
            const recipes = prepDatabase.filter(r => r.property === currentProperty && r.includeInExport !== false);
            if (recipes.length === 0) { showToast('No prep recipes found for this property.', 'warning'); return; }
            const cards = recipes.map(r => buildPrepRecipeCardHTML(r)).join('');
            const w = window.open('', '_blank');
            w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
                <title>${currentProperty} — All Prep Recipes</title>
                <style>${getPrepCardStyles()}</style>
                </head><body>
                ${cards}
                <script>window.onload = function(){ window.print(); }<\/script>
                </body></html>`);
            w.document.close();
        }
		
		function openBulkExportModal() {
    updateBulkExportCategoryFilter();
    const catFilterEl = document.getElementById('bulkExportCategoryFilter');
    if (catFilterEl) catFilterEl.value = 'All';
    renderBulkExportList();
    document.getElementById('bulkExportModal').style.display = 'block';
}

function renderBulkExportList() {
    const catFilter = document.getElementById('bulkExportCategoryFilter')?.value || 'All';
    const list = document.getElementById('bulkExportList');
    const selectAllBox = document.getElementById('bulkSelectAll');
    if (selectAllBox) selectAllBox.checked = false;
    const recipes = prepDatabase.filter(r =>
        r.property === currentProperty &&
        r.includeInExport !== false &&
        (catFilter === 'All' || (r.category || '') === catFilter)
    );
    if (recipes.length === 0) {
        list.innerHTML = '<span style="color:#777;">No prep recipes found for this filter.</span>';
    } else {
        list.innerHTML = recipes.map(r =>
            `<label style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" class="bulk-export-cb" value="${r.id}"> ${escapeHtml(r.name)}${r.category ? ` <span style="color:#999;font-size:0.78rem;">(${escapeHtml(r.category)})</span>` : ''}
            </label>`
        ).join('');
    }
}

function updatePriceCsvFileLabel(input) {
    const label = document.getElementById('priceUpdateCsvFileName');
    if (!label) return;

    const file = input?.files?.[0];
    label.textContent = file ? file.name : 'No CSV selected';
}
function updateBulkExportCategoryFilter() {
    const sel = document.getElementById('bulkExportCategoryFilter');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="All">All Categories</option>';
    prepCategoryDatabase.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat; opt.textContent = cat;
        sel.appendChild(opt);
    });
    sel.value = prepCategoryDatabase.includes(current) ? current : 'All';
}

function toggleBulkSelectAll(cb) {
    document.querySelectorAll('.bulk-export-cb').forEach(box => box.checked = cb.checked);
}

function executeBulkExport() {
    const selected = Array.from(document.querySelectorAll('.bulk-export-cb:checked')).map(cb => cb.value);
    if (selected.length === 0) {
        showToast('Please select at least one recipe to export.', 'warning');
        return;
    }
    const recipes = selected.map(id => getPrepForExport(id)).filter(Boolean);
    const cards = recipes.map(r => buildPrepRecipeCardHTML(r)).join('');
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bulk Export</title><style>${getPrepCardStyles()}</style></head><body>${cards}<script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
    closeModal('bulkExportModal');
}
		
        function getRecipeById(recipeId) {
            return menuDatabase.find(m => m.id === recipeId && m.property === currentProperty);
        }

                function buildAppDataPayload() {
            return {
                appName: 'FB Recipe & COGS Manager',
                version: APP_VERSION,
                exportedAt: new Date().toISOString(),
                currentProperty: currentProperty,
                propertyDatabase: Array.isArray(propertyDatabase) ? [...propertyDatabase] : [],
                categoryDatabase: Array.isArray(categoryDatabase) ? [...categoryDatabase] : [],
                supplierDatabase: Array.isArray(supplierDatabase) ? [...supplierDatabase] : [],
                packTypeDatabase: Array.isArray(packTypeDatabase) ? [...packTypeDatabase] : [],
                unitDescriptorDatabase: Array.isArray(unitDescriptorDatabase) ? [...unitDescriptorDatabase] : [],
                menuItemCategoryDatabase: Array.isArray(menuItemCategoryDatabase) ? [...menuItemCategoryDatabase] : [],
                prepCategoryDatabase: Array.isArray(prepCategoryDatabase) ? [...prepCategoryDatabase] : [],
                inventoryCountDatabase: (inventoryCountDatabase && typeof inventoryCountDatabase === 'object') ? inventoryCountDatabase : {},
                varianceCalcCache: (varianceCalcCache && typeof varianceCalcCache === 'object') ? varianceCalcCache : {},
                varianceLastCalculated: (varianceLastCalculated && typeof varianceLastCalculated === 'object') ? varianceLastCalculated : {},
                itemDatabase: Array.isArray(itemDatabase) ? [...itemDatabase] : [],
                prepDatabase: Array.isArray(prepDatabase) ? [...prepDatabase] : [],
                menuDatabase: Array.isArray(menuDatabase) ? [...menuDatabase] : [],
                propertyMenuDatabase: Array.isArray(propertyMenuDatabase) ? [...propertyMenuDatabase] : []
            };
        }

        function applyAppDataPayload(data) {
            if (!data || typeof data !== 'object') throw new Error('Invalid data file.');
            propertyDatabase = Array.isArray(data.propertyDatabase) ? data.propertyDatabase : [];
            categoryDatabase = Array.isArray(data.categoryDatabase) ? data.categoryDatabase : [];
            supplierDatabase = Array.isArray(data.supplierDatabase) ? data.supplierDatabase : ['Sysco', 'GFS', 'Local Market'];
            packTypeDatabase = Array.isArray(data.packTypeDatabase) ? data.packTypeDatabase : ['Case', 'Bag', 'Bottle', 'Jug', 'Each', 'Keg', 'Container'];
            unitDescriptorDatabase = Array.isArray(data.unitDescriptorDatabase) ? data.unitDescriptorDatabase : ['Unit', 'Bag', 'Box', 'Sleeve', 'Tray', 'Portion'];
            menuItemCategoryDatabase = Array.isArray(data.menuItemCategoryDatabase) ? data.menuItemCategoryDatabase : ['Appies', 'Salads', 'Entrees', 'LWB'];
            prepCategoryDatabase = Array.isArray(data.prepCategoryDatabase) ? data.prepCategoryDatabase : [];
            inventoryCountDatabase = (data.inventoryCountDatabase && typeof data.inventoryCountDatabase === 'object') ? data.inventoryCountDatabase : {};
            varianceCalcCache = (data.varianceCalcCache && typeof data.varianceCalcCache === 'object') ? data.varianceCalcCache : {};
            varianceLastCalculated = (data.varianceLastCalculated && typeof data.varianceLastCalculated === 'object') ? data.varianceLastCalculated : {};
            itemDatabase = Array.isArray(data.itemDatabase) ? data.itemDatabase : [];
            prepDatabase = Array.isArray(data.prepDatabase) ? data.prepDatabase : [];
            menuDatabase = Array.isArray(data.menuDatabase) ? data.menuDatabase : [];
            propertyMenuDatabase = Array.isArray(data.propertyMenuDatabase) ? data.propertyMenuDatabase : [];
            propertyDatabase = propertyDatabase.map(plainText).filter(Boolean);
            categoryDatabase = categoryDatabase.map(plainText).filter(Boolean);
            supplierDatabase = supplierDatabase.map(plainText).filter(Boolean);
            packTypeDatabase = packTypeDatabase.map(plainText).filter(Boolean);
            unitDescriptorDatabase = unitDescriptorDatabase.map(plainText).filter(Boolean);
            if (!unitDescriptorDatabase.includes('Unit')) unitDescriptorDatabase.unshift('Unit');
            menuItemCategoryDatabase = menuItemCategoryDatabase.map(plainText).filter(Boolean);
            prepCategoryDatabase = prepCategoryDatabase.map(plainText).filter(Boolean);
            reconcilePrepCategories();
            sanitizePlainTextFields(itemDatabase, ['id','name','sku','supplier','category','status','packType','unitDescriptor','unitMeasure','recipeMeasure','priceLastUpdated']);
            itemDatabase.forEach(item => { if (!item.unitDescriptor) item.unitDescriptor = 'Unit'; if (!Array.isArray(item.customConversions)) item.customConversions = []; });
            sanitizePlainTextFields(prepDatabase, ['id','property','name','category','yieldUnit','shelfLife','usage','usageUnit','portionUnit']);
            sanitizePlainTextFields(menuDatabase, ['id','property','name','category','cookTime']);
            sanitizePlainTextFields(propertyMenuDatabase, ['id','property','name']);
            prepDatabase.forEach(r => { if (r.steps) r.steps = cleanRichText(r.steps); });
            menuDatabase.forEach(r => { if (r.steps) r.steps = cleanRichText(r.steps); if (r.tipsNotes) r.tipsNotes = cleanRichText(r.tipsNotes); });

                        syncAllItemNamesInRecipes();

            if (data.currentProperty && propertyDatabase.includes(data.currentProperty)) {
                currentProperty = data.currentProperty;
            } else {
                currentProperty = propertyDatabase[0];
            }
            currentPrepIngredients = [];
            currentMenuIngredients = [];
            selectedMenuId = null;
        }

        function saveAllDataToBrowser(showMessage = false) {
            try {
                localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(buildAppDataPayload()));
                markClean();
                if (showMessage) showToast('All data saved to this browser successfully.', 'success');
                return true;
            } catch (err) {
                console.error(err);
                setSaveStatus('Save failed', '#e74c3c');
                showToast('Save failed. Please export a data file as a backup.', 'error');
                return false;
            }
        }

                function loadAllDataFromBrowser() {
            try {
                let raw = localStorage.getItem(APP_STORAGE_KEY);
                let loadedLegacyKey = null;
                if (!raw) {
                    for (const key of LEGACY_STORAGE_KEYS) {
                        raw = localStorage.getItem(key);
                        if (raw) { loadedLegacyKey = key; break; }
                    }
                }
                if (!raw) return false;
                applyAppDataPayload(JSON.parse(raw));
                reconcilePrepCategories();
                refreshAllUI();
                if (loadedLegacyKey) saveAllDataToBrowser(false);
                return true;
            } catch (err) { console.error(err); return false; }
        }


        // --- PWA + LOCAL BACKUP FOLDER SUPPORT ---
        const BACKUP_DB_NAME = 'nova_recipe_builder_backup_db';
        const BACKUP_STORE_NAME = 'settings';
        const BACKUP_FOLDER_KEY = 'backupDirectoryHandle';
        function supportsFileSystemAccess() { return typeof window.showDirectoryPicker === 'function'; }
        function openBackupSettingsDb() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(BACKUP_DB_NAME, 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) db.createObjectStore(BACKUP_STORE_NAME);
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        async function saveBackupDirectoryHandle(handle) {
            const db = await openBackupSettingsDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
                tx.objectStore(BACKUP_STORE_NAME).put(handle, BACKUP_FOLDER_KEY);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        }
        async function getBackupDirectoryHandle() {
            const db = await openBackupSettingsDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
                const request = tx.objectStore(BACKUP_STORE_NAME).get(BACKUP_FOLDER_KEY);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        }
        async function verifyBackupDirectoryPermission(handle, readWrite = true) {
            const options = readWrite ? { mode: 'readwrite' } : {};
            if ((await handle.queryPermission(options)) === 'granted') return true;
            if ((await handle.requestPermission(options)) === 'granted') return true;
            return false;
        }
        async function chooseBackupFolder() {
            if (!supportsFileSystemAccess()) {
                showToast('Folder backup is supported in Microsoft Edge or Chrome desktop. This browser will use Downloads instead.', 'warning');
                return null;
            }
            try {
                const handle = await window.showDirectoryPicker({ id: 'nova-recipe-builder-backups', mode: 'readwrite', startIn: 'documents' });
                const hasPermission = await verifyBackupDirectoryPermission(handle, true);
                if (!hasPermission) { showToast('Backup folder permission was not granted.', 'warning'); return null; }
                await saveBackupDirectoryHandle(handle);
                showToast('Backup folder saved. Future JSON backups will save there when permission is available.', 'success');
                return handle;
            } catch (err) {
                if (err && err.name === 'AbortError') return null;
                console.error(err);
                showToast('Could not save backup folder. Downloads fallback will be used.', 'error');
                return null;
            }
        }
        function downloadJsonFallback(jsonText, fileName) {
            const blob = new Blob([jsonText], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
        async function writeJsonBackupToChosenFolder(jsonText, fileName) {
            let handle = await getBackupDirectoryHandle();
            if (!handle) handle = await chooseBackupFolder();
            if (!handle) return false;
            const hasPermission = await verifyBackupDirectoryPermission(handle, true);
            if (!hasPermission) return false;
            const fileHandle = await handle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(jsonText);
            await writable.close();
            return true;
        }
        async function exportAllDataToFile() {
            try {
                const payload = buildAppDataPayload();
                const jsonText = JSON.stringify(payload, null, 2);
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                const fileName = `fb-manager-data-${stamp}.json`;
                let savedToFolder = false;
                if (supportsFileSystemAccess()) savedToFolder = await writeJsonBackupToChosenFolder(jsonText, fileName);
                if (!savedToFolder) {
                    downloadJsonFallback(jsonText, fileName);
                    showToast('Backup downloaded. To save directly to OneDrive, use Microsoft Edge/Chrome and Choose Backup Folder first.', 'warning');
                } else {
                    showToast(`Backup saved to your chosen folder: ${fileName}`, 'success');
                }
                saveAllDataToBrowser(false);
            } catch (err) {
                console.error(err);
                showToast('Export failed.', 'error');
            }
        }

        function importAllDataFromFile(file) {
    if (!file) {
        showToast('Please select a file to import.', 'warning');
        return;
    }
    const reader = new FileReader();
   reader.onload = function(e) {
    try {
        const data = JSON.parse(e.target.result);

                const fileDate = data.exportedAt ? new Date(data.exportedAt) : null;
        const now = new Date();
        const diffHours = fileDate ? Math.round((now - fileDate) / 1000 / 60 / 60) : null;

        let confirmMessage;
        if (!fileDate) {
            confirmMessage = 'Import this file and replace all current data?';
        } else if (diffHours < 1) {
            confirmMessage = 'Import this file?\n\nThis file was exported less than an hour ago.';
        } else if (diffHours < 24) {
            confirmMessage = 'Import this file?\n\nThis file was exported ' + diffHours + ' hour(s) ago.';
        } else {
            const diffDays = Math.round(diffHours / 24);
            confirmMessage = 'Warning: This file is ' + diffDays + ' day(s) old.\n\nAre you sure you want to load this older file and replace your current data?';
        }

        if (!confirm(confirmMessage)) return;

        applyAppDataPayload(data);
        saveAllDataToBrowser(false);
        refreshAllUI();
        showToast('Data imported successfully.', 'success');
    } catch (err) {
        console.error(err);
        showToast('This file is not a valid app data file.', 'error');
    }
};
    reader.readAsText(file) ;
}

                function refreshAllUI() {
            initSettings();
            updateUIPropertyNames();
            updateItemCategoryDropdown();
            updateSupplierDropdown();
            updateItemCategoryFilterDropdown();
            updateItemSupplierFilterDropdown();
            renderItemTable();
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            updateMenuCategoryFilterOptions();
            renderMenuTable();
            renderPropertyMenuPicker();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            renderVarianceTable();

            const propertySelector = document.getElementById('globalPropertySelector');
            if (propertySelector && currentProperty) propertySelector.value = currentProperty;
        }

        function renderPropertyMenuPicker() {
            const select = document.getElementById('selectedMenuPicker');
            if (!select) return;

            const menus = getCurrentPropertyMenus().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            const validSelection = selectedMenuId && menus.some(m => m.id === selectedMenuId);

            if (!validSelection) {
                selectedMenuId = menus.length > 0 ? menus[0].id : null;
            }

            select.innerHTML = '<option value="">Select Menu...</option>';

            menus.forEach(menu => {
                const opt = document.createElement('option');
                opt.value = menu.id;
                opt.textContent = menu.name;
                select.appendChild(opt);
            });

            if (selectedMenuId) {
                select.value = selectedMenuId;
            }
        }

        function selectPropertyMenu(menuId) {
            selectedMenuId = menuId || null;
            renderPropertyMenuPicker();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function savePropertyMenu() {
            if (!currentProperty) {
                alert('Please create and select a property first.');
                return;
            }

            const name = plainText(document.getElementById('propertyMenuName').value);
            const editId = document.getElementById('editPropertyMenuId').value;

            if (!name) {
                alert('Please enter a menu name.');
                return;
            }

            const existingName = propertyMenuDatabase.find(m =>
                m.property === currentProperty &&
                m.name.toLowerCase() === name.toLowerCase() &&
                m.id !== editId
            );

            if (existingName) {
                alert('A menu with this name already exists for this property.');
                return;
            }

            if (editId) {
                const menu = propertyMenuDatabase.find(m => m.id === editId);
                if (menu) menu.name = name;
                selectedMenuId = editId;
            } else {
                const newMenu = {
                    id: generateId('PMENU'),
                    property: currentProperty,
                    name,
                    categories: []
                };
                propertyMenuDatabase.push(newMenu);
                selectedMenuId = newMenu.id;
            }

            cancelPropertyMenuEdit();
            renderPropertyMenus();
            renderPropertyMenuPicker();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function editPropertyMenu(menuId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;

            document.getElementById('editPropertyMenuId').value = menu.id;
            document.getElementById('propertyMenuName').value = menu.name;
            document.getElementById('propertyMenuSubmitBtn').textContent = 'Save Changes';
            document.getElementById('propertyMenuCancelBtn').style.display = 'block';
            selectedMenuId = menu.id;
            renderPropertyMenuPicker();
            renderSelectedPropertyMenuDetails();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function cancelPropertyMenuEdit() {
            document.getElementById('editPropertyMenuId').value = '';
            document.getElementById('propertyMenuName').value = '';
            document.getElementById('propertyMenuSubmitBtn').textContent = 'Save Menu';
            document.getElementById('propertyMenuCancelBtn').style.display = 'none';
        }

        function deletePropertyMenu(menuId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;

            if (!confirm(`Delete menu "${menu.name}" for ${currentProperty}?`)) return;

            propertyMenuDatabase = propertyMenuDatabase.filter(m => m.id !== menuId);

            if (selectedMenuId === menuId) {
                const remaining = getCurrentPropertyMenus();
                selectedMenuId = remaining.length ? remaining[0].id : null;
            }

            renderPropertyMenus();
            renderPropertyMenuPicker();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function saveMenuCategory() {
            const menu = getSelectedPropertyMenu();
            if (!menu) {
                alert('Please select a menu first.');
                return;
            }

            const categoryName = plainText(document.getElementById('propertyMenuCategoryName').value);
            const editId = document.getElementById('editMenuCategoryId').value;

            if (!categoryName) {
                alert('Please enter a category name.');
                return;
            }

            const existingName = menu.categories.find(c =>
                c.name.toLowerCase() === categoryName.toLowerCase() &&
                c.id !== editId
            );

            if (existingName) {
                alert('That category already exists in this menu.');
                return;
            }

            if (editId) {
                const cat = menu.categories.find(c => c.id === editId);
                if (cat) cat.name = categoryName;
            } else {
                menu.categories.push({
                    id: generateId('MCAT'),
                    name: categoryName,
                    items: []
                });
            }

            cancelMenuCategoryEdit();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function editMenuCategory(categoryId) {
            const menu = getSelectedPropertyMenu();
            if (!menu) return;

            const category = menu.categories.find(c => c.id === categoryId);
            if (!category) return;

            document.getElementById('editMenuCategoryId').value = category.id;
            document.getElementById('propertyMenuCategoryName').value = category.name;
            document.getElementById('menuCategorySubmitBtn').textContent = 'Save Changes';
            document.getElementById('menuCategoryCancelBtn').style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function cancelMenuCategoryEdit() {
            document.getElementById('editMenuCategoryId').value = '';
            document.getElementById('propertyMenuCategoryName').value = '';
            document.getElementById('menuCategorySubmitBtn').textContent = 'Save Category';
            document.getElementById('menuCategoryCancelBtn').style.display = 'none';
        }

        function deleteMenuCategory(menuId, categoryId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;

            const category = menu.categories.find(c => c.id === categoryId);
            if (!category) return;

            if (!confirm(`Delete category "${category.name}" from menu "${menu.name}"?`)) return;

            menu.categories = menu.categories.filter(c => c.id !== categoryId);
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function addRecipeToCategory(menuId, categoryId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;

            const category = menu.categories.find(c => c.id === categoryId);
            if (!category) return;

            const select = document.getElementById(`recipePicker-${categoryId}`);
            const recipeId = select.value;

            if (!recipeId) {
                alert('Please select a menu item recipe.');
                return;
            }

            const recipe = getRecipeById(recipeId);
            if (!recipe) {
                alert('Recipe not found for this property.');
                return;
            }

            const existingLine = category.items.find(i => i.recipeId === recipeId);
            if (existingLine) {
                alert('That recipe is already in this category.');
                return;
            }

            category.items.push({
                id: generateId('MLINE'),
                recipeId,
                soldQty: 0
            });

            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function deleteMenuLine(menuId, categoryId, lineId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;

            const category = menu.categories.find(c => c.id === categoryId);
            if (!category) return;

            category.items = category.items.filter(i => i.id !== lineId);
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function getMenuCategoryByIds(menuId, categoryId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return null;
            const category = menu.categories.find(c => c.id === categoryId);
            return category ? { menu, category } : null;
        }

        function toggleMenuCategoryCollapse(menuId, categoryId) {
            const found = getMenuCategoryByIds(menuId, categoryId);
            if (!found) return;
            found.category.collapsed = !found.category.collapsed;
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function setAllMenuCategoriesCollapsed(collapsed) {
            const menu = getSelectedPropertyMenu();
            if (!menu) return;
            menu.categories.forEach(cat => cat.collapsed = collapsed);
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function updateCategorySortMode(menuId, categoryId, sortMode) {
            const found = getMenuCategoryByIds(menuId, categoryId);
            if (!found) return;
            found.category.sortMode = sortMode || 'manual';
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function getSortedCategoryItems(category) {
            const mode = category.sortMode || 'manual';
            const lines = [...(category.items || [])];
            if (mode === 'fc-high-low' || mode === 'cost-high-low') {
                return lines.sort((a, b) => (calculateMenuLine(b)?.theoreticalPct || 0) - (calculateMenuLine(a)?.theoreticalPct || 0));
            }
            if (mode === 'fc-low-high' || mode === 'cost-low-high') {
                return lines.sort((a, b) => (calculateMenuLine(a)?.theoreticalPct || 0) - (calculateMenuLine(b)?.theoreticalPct || 0));
            }
            if (mode === 'sold-high-low') {
                return lines.sort((a, b) => parseFloat(b.soldQty || 0) - parseFloat(a.soldQty || 0));
            }
            if (mode === 'sold-low-high') {
                return lines.sort((a, b) => parseFloat(a.soldQty || 0) - parseFloat(b.soldQty || 0));
            }
            return lines;
        }

        function onMenuLineDragStart(event, menuId, categoryId, lineId) {
            const found = getMenuCategoryByIds(menuId, categoryId);
            if (!found || (found.category.sortMode || 'manual') !== 'manual') {
                event.preventDefault();
                showToast('Switch this category to Sort: Menu Layout before dragging items.', 'warning');
                return;
            }
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', JSON.stringify({ menuId, categoryId, lineId }));
            event.currentTarget.classList.add('dragging-row');
        }

        function onMenuLineDragOver(event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            event.currentTarget.classList.add('drag-over-row');
        }

        function onMenuLineDragLeave(event) {
            event.currentTarget.classList.remove('drag-over-row');
        }

        function onMenuLineDragEnd(event) {
            event.currentTarget.classList.remove('dragging-row', 'drag-over-row');
            document.querySelectorAll('.drag-over-row').forEach(row => row.classList.remove('drag-over-row'));
        }

        function onMenuLineDrop(event, menuId, categoryId, targetLineId) {
            event.preventDefault();
            event.currentTarget.classList.remove('drag-over-row');
            let payload;
            try { payload = JSON.parse(event.dataTransfer.getData('text/plain') || '{}'); } catch (err) { return; }
            if (!payload || payload.menuId !== menuId || payload.categoryId !== categoryId || payload.lineId === targetLineId) return;
            const found = getMenuCategoryByIds(menuId, categoryId);
            if (!found || (found.category.sortMode || 'manual') !== 'manual') return;
            const items = found.category.items || [];
            const fromIndex = items.findIndex(i => i.id === payload.lineId);
            const toIndex = items.findIndex(i => i.id === targetLineId);
            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
            const [moved] = items.splice(fromIndex, 1);
            items.splice(toIndex, 0, moved);
            found.category.items = items;
            found.category.sortMode = 'manual';
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function updateLineSoldQty(menuId, categoryId, lineId, value) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;

            const category = menu.categories.find(c => c.id === categoryId);
            if (!category) return;

            const line = category.items.find(i => i.id === lineId);
            if (!line) return;

            line.soldQty = Math.max(0, parseFloat(value) || 0);
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }
        function resetCategorySoldQty(menuId, categoryId) {
            const menu = propertyMenuDatabase.find(m => m.id === menuId && m.property === currentProperty);
            if (!menu) return;
            const category = menu.categories.find(c => c.id === categoryId);
            if (!category) return;
            if (!category.items || category.items.length === 0) {
                showToast('No recipes in this category to reset.', 'warning');
                return;
            }
            category.items.forEach(line => line.soldQty = 0);
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
            showToast(`Sold quantities reset for ${category.name}.`, 'success');
        }


        function calculateMenuLine(line) {
            const recipe = getRecipeById(line.recipeId);
            if (!recipe) return null;

            const price = parseFloat(recipe.targetPrice || 0);
            const cost = calculateMenuFoodCostExcludingCredits(recipe);
            const soldQty = parseFloat(line.soldQty || 0);

            const sales = price * soldQty;
            const theoreticalCost = cost * soldQty;
            const theoreticalPct = sales > 0 ? (theoreticalCost / sales) * 100 : 0;

            return {
                recipe,
                price,
                cost,
                soldQty,
                sales,
                theoreticalCost,
                theoreticalPct
            };
        }

        function calculateCategoryTotals(category) {
            let sales = 0;
            let cost = 0;

            category.items.forEach(line => {
                const calc = calculateMenuLine(line);
                if (!calc) return;
                sales += calc.sales;
                cost += calc.theoreticalCost;
            });

            return {
                sales,
                cost,
                theoreticalPct: sales > 0 ? (cost / sales) * 100 : 0
            };
        }

        function calculateMenuTotals(menu) {
            let sales = 0;
            let cost = 0;
            let itemCount = 0;

            menu.categories.forEach(category => {
                const totals = calculateCategoryTotals(category);
                sales += totals.sales;
                cost += totals.cost;
                itemCount += category.items.length;
            });

            return {
                sales,
                cost,
                itemCount,
                categoryCount: menu.categories.length,
                theoreticalPct: sales > 0 ? (cost / sales) * 100 : 0
            };
        }

        function renderPropertyMenus() {
            renderPropertyMenuPicker();

            const tbody = document.getElementById('propertyMenuTableBody');
            if (!tbody) return;

            const menus = getCurrentPropertyMenus();
			
			let propertySales = 0;
			let propertyCost = 0;

			const summaryContainer =
    		document.getElementById('propertyMenuSummary');
			
            tbody.innerHTML = '';

            if (menus.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#777;">No menus created for this property yet.</td></tr>`;
                return;
            }

            menus.forEach(menu => {
                const totals = calculateMenuTotals(menu);

				propertySales += totals.sales;
				propertyCost += totals.cost;
				
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${menu.name}</strong></td>
                    <td>${totals.categoryCount}</td>
                    <td>${totals.itemCount}</td>
                    <td>$${totals.sales.toFixed(2)}</td>
                    <td>$${totals.cost.toFixed(2)}</td>
                    <td style="font-weight:bold; color:${totals.theoreticalPct > 35 ? '#e74c3c' : (totals.theoreticalPct >= 30 ? '#f39c12' : '#18bc9c')};">${totals.theoreticalPct.toFixed(1)}%</td>
                    <td>
                        <button class="action-btn" onclick="selectPropertyMenu('${menu.id}')">Open</button>
                        <button class="action-btn" onclick="editPropertyMenu('${menu.id}')">Edit</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deletePropertyMenu('${menu.id}')">Delete</button>
                    </td>
                `;
                tbody.appendChild(row);
            });

			if (summaryContainer) {
    summaryContainer.innerHTML = `
        <div class="recipe-meta-card">
            <strong>Total Menus</strong>
            ${menus.length}
        </div>

        <div class="recipe-meta-card">
            <strong>Total Sales</strong>
            $${propertySales.toFixed(2)}
        </div>

        <div class="recipe-meta-card">
            <strong>Total Theo Cost</strong>
            $${propertyCost.toFixed(2)}
        </div>

        <div class="recipe-meta-card">
            <strong>Property Theo FC %</strong>
            ${propertySales > 0
                ? ((propertyCost / propertySales) * 100).toFixed(1)
                : '0.0'}%
        </div>
    `;
}
			
			const propertyPct =
			    propertySales > 0
			        ? (propertyCost / propertySales) * 100
			        : 0;
			
			tbody.innerHTML += `
			<tr style="background:#2c3e50; color:white; font-weight:bold;">
			    <td>PROPERTY TOTAL</td>
			    <td>-</td>
			    <td>-</td>
			    <td>$${propertySales.toFixed(2)}</td>
			    <td>$${propertyCost.toFixed(2)}</td>
				<td style="color:${ 
						propertyPct > 35
				        ? '#e74c3c'
				        : (propertyPct >= 30 ? '#f39c12' : '#18bc9c')
				};">
				    ${propertyPct.toFixed(1)}%
				</td>			    
				<td></td>
			</tr>`;
        }

        function renderSelectedPropertyMenuDetails() {
            const container = document.getElementById('selectedPropertyMenuDetails');
            if (!container) return;

            const menu = getSelectedPropertyMenu();

            if (!menu) {
                container.innerHTML = `<p style="color:#777;">Select or create a menu to begin adding categories and menu items.</p>`;
                return;
            }

            let html = '';

            if (menu.categories.length === 0) {
                html += `<p style="color:#777;">No categories added to this menu yet.</p>`;
            }

            menu.categories.forEach(category => {
                const totals = calculateCategoryTotals(category);

                const recipesAlreadyOnMenus = new Set();
                propertyMenuDatabase
                    .filter(pm => pm.property === currentProperty)
                    .forEach(pm => (pm.categories || []).forEach(cat => (cat.items || []).forEach(line => recipesAlreadyOnMenus.add(line.recipeId))));
                const categoryRecipes = menuDatabase
                    .filter(r =>
                        r.property === currentProperty &&
                        (r.category || '').toLowerCase() === (category.name || '').toLowerCase()
                    )
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                const recipeOptions = categoryRecipes
                    .map(r => {
                        const alreadyOnMenu = recipesAlreadyOnMenus.has(r.id);
                        const check = alreadyOnMenu ? '✓ ' : '';
                        const style = alreadyOnMenu ? ' style="color:#18bc9c; font-weight:bold;"' : '';
                        return `<option value="${escapeHtml(r.id)}"${style}>${check}${escapeHtml(r.name || 'Unnamed Recipe')}</option>`;
                    })
                    .join('');
                const recipePickerPlaceholder = categoryRecipes.length > 0
                    ? 'Select Menu Item Recipe...'
                    : `No ${escapeHtml(category.name)} recipes found`;

                const sortMode = category.sortMode || 'manual';
                const displayLines = getSortedCategoryItems(category);
                const rows = displayLines.map(line => {
                    const calc = calculateMenuLine(line);
                    if (!calc) {
                        return `
                            <tr>
                                <td colspan="8" style="color:#777;">A linked recipe could not be found.</td>
                            </tr>
                        `;
                    }

                    return `
                        <tr class="menu-line-row" draggable="${sortMode === 'manual'}" ondragstart="onMenuLineDragStart(event,'${menu.id}','${category.id}','${line.id}')" ondragover="onMenuLineDragOver(event)" ondragleave="onMenuLineDragLeave(event)" ondragend="onMenuLineDragEnd(event)" ondrop="onMenuLineDrop(event,'${menu.id}','${category.id}','${line.id}')">
                            <td><span title="Drag to reorder" style="display:inline-block; cursor:${sortMode === 'manual' ? 'grab' : 'not-allowed'}; color:#7f8c8d; margin-right:8px; font-weight:bold;">⋮⋮</span><strong>${calc.recipe.name}</strong></td>
                            <td>$${calc.price.toFixed(2)}</td>
                            <td>$${calc.cost.toFixed(2)}</td>
                            <td><input class="sold-input" type="number" step="1" min="0" value="${calc.soldQty}" onchange="updateLineSoldQty('${menu.id}','${category.id}','${line.id}', this.value)"></td>
                            <td>$${calc.sales.toFixed(2)}</td>
                            <td>$${calc.theoreticalCost.toFixed(2)}</td>
                            <td style="font-weight:bold; color:${calc.theoreticalPct > 35 ? '#e74c3c' : (calc.theoreticalPct >= 30 ? '#f39c12' : '#18bc9c')};">${calc.theoreticalPct.toFixed(1)}%</td>
                            <td><button class="action-btn" style="background-color: var(--cancel);" onclick="deleteMenuLine('${menu.id}','${category.id}','${line.id}')">X</button></td>
                        </tr>
                    `;
                }).join('');

                if (category.collapsed === undefined) category.collapsed = true;
                const isCollapsed = !!category.collapsed;
                const catColor = totals.theoreticalPct > 35 ? '#e74c3c' : (totals.theoreticalPct >= 30 ? '#f39c12' : '#18bc9c');

                html += `
                    <div class="form-section">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; cursor:pointer;" onclick="toggleMenuCategoryCollapse('${menu.id}','${category.id}')">
                            <h3 style="margin:0;"><span style="display:inline-block; width:16px;">${isCollapsed ? '▶' : '▼'}</span> ${escapeHtml(category.name)}</h3>
                            <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap; justify-content:flex-end; font-size:0.85rem; color:#555;">
                                <span>Sales: <strong>$${totals.sales.toFixed(2)}</strong></span>
                                <span>Cost: <strong>$${totals.cost.toFixed(2)}</strong></span>
                                <span style="font-weight:bold; color:${catColor};">${totals.theoreticalPct.toFixed(1)}%</span>
                            </div>
                        </div>
                `;

                if (!isCollapsed) {
                    html += `
                        <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; flex-wrap:wrap; margin-top:12px;" onclick="event.stopPropagation()">
                            <select onchange="updateCategorySortMode('${menu.id}','${category.id}', this.value)" style="width:auto; min-width:195px; padding:5px; font-size:0.78rem;">
                                <option value="manual" ${sortMode === 'manual' ? 'selected' : ''}>Sort: Menu Layout</option>
                                <option value="fc-high-low" ${(sortMode === 'fc-high-low' || sortMode === 'cost-high-low') ? 'selected' : ''}>FC %: High to Low</option>
                                <option value="fc-low-high" ${(sortMode === 'fc-low-high' || sortMode === 'cost-low-high') ? 'selected' : ''}>FC %: Low to High</option>
                                <option value="sold-high-low" ${sortMode === 'sold-high-low' ? 'selected' : ''}>Sold: Most to Least</option>
                                <option value="sold-low-high" ${sortMode === 'sold-low-high' ? 'selected' : ''}>Sold: Least to Most</option>
                            </select>
                            <button class="action-btn" onclick="editMenuCategory('${category.id}')">Edit</button>
                            <button class="mini-action-btn" onclick="resetCategorySoldQty('${menu.id}','${category.id}')">Reset Sold</button>
                            <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteMenuCategory('${menu.id}','${category.id}')">Delete</button>
                        </div>

                        <div style="display:flex; gap:10px; margin:15px 0; flex-wrap:wrap;" onclick="event.stopPropagation()">
                            <select id="recipePicker-${category.id}" style="flex:1; min-width:250px;">
                                <option value="">${recipePickerPlaceholder}</option>
                                ${recipeOptions}
                            </select>
                            <button class="action-btn" style="background-color: var(--secondary);" onclick="addRecipeToCategory('${menu.id}','${category.id}')">Add Recipe</button>
                        </div>

                        <table onclick="event.stopPropagation()">
                            <thead>
                                <tr>
                                    <th>Menu Item Recipe</th>
                                    <th>Price</th>
                                    <th>Cost</th>
                                    <th>Sold</th>
                                    <th>Sales</th>
                                    <th>Theo Cost</th>
                                    <th>Theo FC %</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows || '<tr><td colspan="8" style="text-align:center; color:#777;">No recipes in this category yet.</td></tr>'}
                                <tr style="background-color:#e9ecef; font-weight:bold;">
                                    <td colspan="4" style="text-align:right;">Category Totals</td>
                                    <td>$${totals.sales.toFixed(2)}</td>
                                    <td>$${totals.cost.toFixed(2)}</td>
                                    <td colspan="2" style="font-weight:bold; color:${catColor};">${totals.theoreticalPct.toFixed(1)}%</td>
                                </tr>
                            </tbody>
                        </table>
                    `;
                }

                html += `</div>`;
            });

            const menuTotals = calculateMenuTotals(menu);

            html += `
                <div class="form-section">
                    <h3>${menu.name} Totals</h3>
                    <div class="grid-3">
                        <div><strong>Total Sales:</strong><br>$${menuTotals.sales.toFixed(2)}</div>
                        <div><strong>Total Theo Cost:</strong><br>$${menuTotals.cost.toFixed(2)}</div>
                                                <div><strong>Theoretical Food Cost:</strong><br><span style="font-weight:bold; color:${menuTotals.theoreticalPct > 35 ? '#e74c3c' : (menuTotals.theoreticalPct >= 30 ? '#f39c12' : '#18bc9c')};">${menuTotals.theoreticalPct.toFixed(1)}%</span></div>
                    </div>
                </div>
            `;

            container.innerHTML = html;
        }

        // CATEGORIES
                       // --- MENU ITEM CATEGORIES ---
        function renderMenuItemCategoryTable() {
            const tbody = document.getElementById('menuItemCategoryTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            menuItemCategoryDatabase.forEach(cat => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:8px 0"><strong>${cat}</strong></td>
                    <td style="text-align:right; padding:8px 0">
                        <button class="action-btn" onclick="editMenuItemCategory('${cat}')">Edit</button>
                        <button class="action-btn" style="background-color:var(--cancel)" onclick="deleteMenuItemCategory('${cat}')">X</button>
                    </td>`;
                tbody.appendChild(tr);
            });
            updateMenuItemCategoryDropdown();
            updateMenuCategoryFilterOptions();
        }

        function addMenuItemCategory() {
            const val = plainText(document.getElementById('newMenuItemCategoryName').value);
            if (!val) return;
            if (menuItemCategoryDatabase.includes(val)) { alert('Category already exists.'); return; }
            menuItemCategoryDatabase.push(val);
            menuItemCategoryDatabase.sort((a, b) => a.localeCompare(b));
            document.getElementById('newMenuItemCategoryName').value = '';
            renderMenuItemCategoryTable();
            saveAllDataToBrowser(false);
        }

        function editMenuItemCategory(oldCat) {
            const newCat = prompt('Enter new category name:', oldCat);
            if (!newCat || !newCat.trim() || newCat.trim() === oldCat) return;
            if (menuItemCategoryDatabase.includes(newCat.trim())) { alert('A category with this name already exists.'); return; }
            const idx = menuItemCategoryDatabase.indexOf(oldCat);
            if (idx !== -1) menuItemCategoryDatabase[idx] = newCat.trim();
            menuItemCategoryDatabase.sort((a, b) => a.localeCompare(b));
            menuDatabase.forEach(m => { if (m.category === oldCat) m.category = newCat.trim(); });
            renderMenuItemCategoryTable();
            renderMenuTable();
            saveAllDataToBrowser(false);
        }

        function deleteMenuItemCategory(cat) {
            const inUse = menuDatabase.filter(m => m.category === cat);
            if (inUse.length > 0) {
                alert(`Cannot delete "${cat}" — it is used by ${inUse.length} menu item(s). Reassign them first.`);
                return;
            }
            if (!confirm(`Delete category "${cat}"?`)) return;
            menuItemCategoryDatabase = menuItemCategoryDatabase.filter(c => c !== cat);
            renderMenuItemCategoryTable();
            saveAllDataToBrowser(false);
        }

        // --- PREP CATEGORIES (Global) ---
        function reconcilePrepCategories() {
            const usedCategories = new Set(prepDatabase.map(p => p.category).filter(Boolean));
            usedCategories.forEach(cat => {
                if (!prepCategoryDatabase.includes(cat)) prepCategoryDatabase.push(cat);
            });
            prepCategoryDatabase.sort((a, b) => a.localeCompare(b));
        }

        function renderPrepCategoryTable() {
            const tbody = document.getElementById('prepCategoryTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            prepCategoryDatabase.forEach(cat => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding:8px 0"><strong>${escapeHtml(cat)}</strong></td>
                    <td style="text-align:right; padding:8px 0">
                        <button class="action-btn" onclick="editPrepCategory('${escapeHtml(cat)}')">Edit</button>
                        <button class="action-btn" style="background-color:var(--cancel)" onclick="deletePrepCategory('${escapeHtml(cat)}')">X</button>
                    </td>`;
                tbody.appendChild(tr);
            });
            updatePrepCategoryDropdown();
            updatePrepCategoryFilterDropdown();
            updateBulkExportCategoryFilter();
        }

        function addPrepCategory() {
            const input = document.getElementById('newPrepCategoryName');
            const val = plainText(input.value);
            if (!val) return;
            if (prepCategoryDatabase.includes(val)) { alert('Category already exists.'); return; }
            prepCategoryDatabase.push(val);
            prepCategoryDatabase.sort((a, b) => a.localeCompare(b));
            input.value = '';
            renderPrepCategoryTable();
            saveAllDataToBrowser(false);
        }

        function editPrepCategory(oldCat) {
            const newCat = prompt('Enter new category name:', oldCat);
            if (!newCat || !newCat.trim() || newCat.trim() === oldCat) return;
            if (prepCategoryDatabase.includes(newCat.trim())) { alert('A category with this name already exists.'); return; }
            const idx = prepCategoryDatabase.indexOf(oldCat);
            if (idx !== -1) prepCategoryDatabase[idx] = newCat.trim();
            prepCategoryDatabase.sort((a, b) => a.localeCompare(b));
            prepDatabase.forEach(p => { if (p.category === oldCat) p.category = newCat.trim(); });
            renderPrepCategoryTable();
            renderPrepTable();
            saveAllDataToBrowser(false);
        }

        function deletePrepCategory(cat) {
            const inUse = prepDatabase.filter(p => p.category === cat);
            if (inUse.length > 0) {
                if (!confirm(`${inUse.length} prep recipe(s) use "${cat}". Delete this category anyway? Those recipes will become Uncategorized.`)) return;
                inUse.forEach(p => p.category = '');
            } else if (!confirm(`Delete category "${cat}"?`)) {
                return;
            }
            prepCategoryDatabase = prepCategoryDatabase.filter(c => c !== cat);
            renderPrepCategoryTable();
            renderPrepTable();
            saveAllDataToBrowser(false);
        }

        function updatePrepCategoryDropdown() {
            const sel = document.getElementById('prepCategory');
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '<option value="">Uncategorized</option>';
            prepCategoryDatabase.slice().sort((a, b) => a.localeCompare(b)).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                sel.appendChild(opt);
            });
            if (prepCategoryDatabase.includes(current)) sel.value = current;
        }

        function updatePrepCategoryFilterDropdown() {
            const sel = document.getElementById('filterPrepCategory');
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '<option value="All">All Categories</option>';
            prepCategoryDatabase.slice().sort((a, b) => a.localeCompare(b)).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                sel.appendChild(opt);
            });
            sel.value = prepCategoryDatabase.includes(current) ? current : 'All';
        }

                function updateMenuItemCategoryDropdown() {
            ['menuCategory', 'propertyMenuCategoryName'].forEach(selId => {
                const sel = document.getElementById(selId);
                if (!sel) return;
                const current = sel.value;
                sel.innerHTML = '<option value="" disabled selected>Select Category...</option>';
                [...menuItemCategoryDatabase].sort((a, b) => a.localeCompare(b)).forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat;
                    opt.textContent = cat;
                    sel.appendChild(opt);
                });
                if (menuItemCategoryDatabase.includes(current)) sel.value = current;
            });
        }
        function renderCategoryTable() {
            const tbody = document.getElementById('categoryTableBody');
            if (!tbody) return;

            tbody.innerHTML = '';
            categoryDatabase.forEach(cat => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 8px 0;"><strong>${cat}</strong></td>
                    <td style="text-align: right; padding: 8px 0;">
                        <button class="action-btn" onclick="editCategory('${cat}')">Edit</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteCategory('${cat}')">X</button>
                    </td>`;
                tbody.appendChild(tr);
            });

            updateItemCategoryDropdown();
            updateItemCategoryFilterDropdown();
        }

        function addCategory() {
            const val = plainText(document.getElementById('newCategoryName').value);
            if (val && !categoryDatabase.includes(val)) {
                categoryDatabase.push(val);
                categoryDatabase.sort((a, b) => a.localeCompare(b));
                document.getElementById('newCategoryName').value = '';
                renderCategoryTable();
                renderItemTable();
                saveAllDataToBrowser(false);
            } else if (categoryDatabase.includes(val)) {
                alert("Category already exists.");
            }
        }

        function editCategory(oldCat) {
            const newCat = prompt("Enter new category name:", oldCat);
            if (newCat && newCat.trim() !== "" && newCat !== oldCat) {
                if (categoryDatabase.includes(newCat.trim())) {
                    alert("A category with this name already exists.");
                    return;
                }
                const idx = categoryDatabase.indexOf(oldCat);
                if (idx > -1) {
                    categoryDatabase[idx] = newCat.trim();
                    categoryDatabase.sort((a, b) => a.localeCompare(b));
                    itemDatabase.forEach(item => {
                        if (item.category === oldCat) item.category = newCat.trim();
                    });
                    renderCategoryTable();
                    renderItemTable();
                    saveAllDataToBrowser(false);
                }
            }
        }

        function deleteCategory(cat) {
            if (confirm(`Are you sure you want to delete the category '${cat}'?`)) {
                categoryDatabase = categoryDatabase.filter(c => c !== cat);
                renderCategoryTable();
                renderItemTable();
                saveAllDataToBrowser(false);
            }
        }

        function updateItemCategoryDropdown() {
            const sel = document.getElementById('itemCategory');
            if (!sel) return;

            const current = sel.value;
            sel.innerHTML = '';
            categoryDatabase.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                sel.appendChild(opt);
            });

            if (categoryDatabase.includes(current)) sel.value = current;
            else if (categoryDatabase.length > 0) sel.value = categoryDatabase[0];
        }

        function updateItemCategoryFilterDropdown() {
            const sel = document.getElementById('filterItemCategory');
            if (!sel) return;

            const current = sel.value;
            sel.innerHTML = '<option value="All">All Categories</option>';

            categoryDatabase.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                sel.appendChild(opt);
            });

            if (categoryDatabase.includes(current) || current === 'All') {
                sel.value = current || 'All';
            }
        }

        // SUPPLIERS
        function renderSupplierTable() {
            const tbody = document.getElementById('supplierTableBody');
            if (!tbody) return;

            tbody.innerHTML = '';
            supplierDatabase.forEach(supplier => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 8px 0;"><strong>${supplier}</strong></td>
                    <td style="text-align: right; padding: 8px 0;">
                        <button class="action-btn" onclick="editSupplier('${supplier}')">Edit</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteSupplier('${supplier}')">X</button>
                    </td>`;
                tbody.appendChild(tr);
            });

            updateSupplierDropdown();
        }

        function addSupplier() {
            const val = plainText(document.getElementById('newSupplierName').value);
            if (val && !supplierDatabase.includes(val)) {
                supplierDatabase.push(val);
                supplierDatabase.sort((a, b) => a.localeCompare(b));
                document.getElementById('newSupplierName').value = '';
                renderSupplierTable();
                renderItemTable();
                saveAllDataToBrowser(false);
            } else if (supplierDatabase.includes(val)) {
                alert("Supplier already exists.");
            }
        }

        function editSupplier(oldSupplier) {
            const newSupplier = prompt("Enter new supplier name:", oldSupplier);
            if (newSupplier && newSupplier.trim() !== "" && newSupplier !== oldSupplier) {
                if (supplierDatabase.includes(newSupplier.trim())) {
                    alert("A supplier with this name already exists.");
                    return;
                }
                const idx = supplierDatabase.indexOf(oldSupplier);
                if (idx > -1) {
                    supplierDatabase[idx] = newSupplier.trim();
                    supplierDatabase.sort((a, b) => a.localeCompare(b));
                    itemDatabase.forEach(item => {
                        if (item.supplier === oldSupplier) item.supplier = newSupplier.trim();
                    });
                    renderSupplierTable();
                    renderItemTable();
                    saveAllDataToBrowser(false);
                }
            }
        }

        function deleteSupplier(supplier) {
            if (confirm(`Are you sure you want to delete the supplier '${supplier}'?`)) {
                supplierDatabase = supplierDatabase.filter(s => s !== supplier);
                itemDatabase.forEach(item => {
                    if (item.supplier === supplier) item.supplier = '';
                });
                renderSupplierTable();
                renderItemTable();
                saveAllDataToBrowser(false);
            }
        }

        function updateSupplierDropdown() {
            const sel = document.getElementById('itemSupplier');
            if (!sel) return;

            const current = sel.value;
            sel.innerHTML = '<option value="">Unassigned</option>';

            supplierDatabase.forEach(supplier => {
                const opt = document.createElement('option');
                opt.value = supplier;
                opt.textContent = supplier;
                sel.appendChild(opt);
            });

            if (supplierDatabase.includes(current) || current === '') {
                sel.value = current;
            } else {
                sel.value = '';
            }
        }

        // --- PACK TYPE (Received As) GLOBAL LIST ---
        function renderPackTypeTable() {
            const tbody = document.getElementById('packTypeTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            packTypeDatabase.forEach(pt => {
                const inUse = itemDatabase.some(item => item.packType === pt);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 8px 0;"><strong>${escapeHtml(pt)}</strong>${inUse ? ' <span style="font-size:0.72rem;color:#7f8c8d;">(in use)</span>' : ''}</td>
                    <td style="text-align: right; padding: 8px 0;">
                        <button class="action-btn" onclick="editPackType('${escapeHtml(pt)}')">Edit</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deletePackType('${escapeHtml(pt)}')">X</button>
                    </td>`;
                tbody.appendChild(tr);
            });
            updatePackTypeDropdown();
        }

        function addPackType() {
            const val = plainText(document.getElementById('newPackTypeName').value);
            if (val && !packTypeDatabase.includes(val)) {
                packTypeDatabase.push(val);
                packTypeDatabase.sort((a, b) => a.localeCompare(b));
                document.getElementById('newPackTypeName').value = '';
                renderPackTypeTable();
                renderItemTable();
                saveAllDataToBrowser(false);
            } else if (packTypeDatabase.includes(val)) {
                alert('That pack type already exists.');
            }
        }

        function editPackType(oldVal) {
            const newVal = prompt('Enter new pack type name:', oldVal);
            if (newVal && newVal.trim() !== '' && newVal !== oldVal) {
                const trimmed = newVal.trim();
                if (packTypeDatabase.includes(trimmed)) {
                    alert('A pack type with this name already exists.');
                    return;
                }
                const idx = packTypeDatabase.indexOf(oldVal);
                if (idx > -1) {
                    packTypeDatabase[idx] = trimmed;
                    packTypeDatabase.sort((a, b) => a.localeCompare(b));
                    itemDatabase.forEach(item => { if (item.packType === oldVal) item.packType = trimmed; });
                    renderPackTypeTable();
                    renderItemTable();
                    saveAllDataToBrowser(false);
                }
            }
        }

        function deletePackType(pt) {
            const inUse = itemDatabase.filter(item => item.packType === pt);
            if (inUse.length > 0) {
                const names = inUse.map(i => `• ${i.name}`).join('\n');
                alert(`❌ Cannot delete "${pt}" — it is currently used by the following items:\n\n${names}\n\nChange those items to a different pack type first.`);
                return;
            }
            if (confirm(`Are you sure you want to delete the pack type '${pt}'?`)) {
                packTypeDatabase = packTypeDatabase.filter(p => p !== pt);
                renderPackTypeTable();
                renderItemTable();
                saveAllDataToBrowser(false);
            }
        }

        function updatePackTypeDropdown() {
            const sel = document.getElementById('packType');
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '<option value="" disabled>Select Pack Type...</option>';
            packTypeDatabase.forEach(pt => {
                const opt = document.createElement('option');
                opt.value = pt;
                opt.textContent = pt;
                sel.appendChild(opt);
            });
            if (packTypeDatabase.includes(current)) sel.value = current;
            updateItemFormPreview();
        }

        // --- UNIT DESCRIPTOR (per-Unit-in-Pack label) GLOBAL LIST ---
        function renderUnitDescriptorTable() {
            const tbody = document.getElementById('unitDescriptorTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            unitDescriptorDatabase.forEach(ud => {
                const inUse = itemDatabase.some(item => item.unitDescriptor === ud);
                const isDefault = ud === 'Unit';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 8px 0;"><strong>${escapeHtml(ud)}</strong>${inUse ? ' <span style="font-size:0.72rem;color:#7f8c8d;">(in use)</span>' : ''}${isDefault ? ' <span style="font-size:0.72rem;color:#7f8c8d;">(default)</span>' : ''}</td>
                    <td style="text-align: right; padding: 8px 0;">
                        <button class="action-btn" onclick="editUnitDescriptor('${escapeHtml(ud)}')" ${isDefault ? 'disabled title="The default label cannot be renamed"' : ''}>Edit</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteUnitDescriptor('${escapeHtml(ud)}')" ${isDefault ? 'disabled title="The default label cannot be deleted"' : ''}>X</button>
                    </td>`;
                tbody.appendChild(tr);
            });
            updateUnitDescriptorDropdown();
        }

        function addUnitDescriptor() {
            const val = plainText(document.getElementById('newUnitDescriptorName').value);
            if (val && !unitDescriptorDatabase.includes(val)) {
                unitDescriptorDatabase.push(val);
                unitDescriptorDatabase.sort((a, b) => a.localeCompare(b));
                document.getElementById('newUnitDescriptorName').value = '';
                renderUnitDescriptorTable();
                renderItemTable();
                renderVarianceTable();
                saveAllDataToBrowser(false);
            } else if (unitDescriptorDatabase.includes(val)) {
                alert('That unit descriptor already exists.');
            }
        }

        function editUnitDescriptor(oldVal) {
            if (oldVal === 'Unit') return;
            const newVal = prompt('Enter new unit descriptor name:', oldVal);
            if (newVal && newVal.trim() !== '' && newVal !== oldVal) {
                const trimmed = newVal.trim();
                if (unitDescriptorDatabase.includes(trimmed)) {
                    alert('A unit descriptor with this name already exists.');
                    return;
                }
                const idx = unitDescriptorDatabase.indexOf(oldVal);
                if (idx > -1) {
                    unitDescriptorDatabase[idx] = trimmed;
                    unitDescriptorDatabase.sort((a, b) => a.localeCompare(b));
                    itemDatabase.forEach(item => { if (item.unitDescriptor === oldVal) item.unitDescriptor = trimmed; });
                    renderUnitDescriptorTable();
                    renderItemTable();
                    renderVarianceTable();
                    saveAllDataToBrowser(false);
                }
            }
        }

        function deleteUnitDescriptor(ud) {
            if (ud === 'Unit') return;
            const inUse = itemDatabase.filter(item => item.unitDescriptor === ud);
            if (inUse.length > 0) {
                const names = inUse.map(i => `• ${i.name}`).join('\n');
                alert(`❌ Cannot delete "${ud}" — it is currently used by the following items:\n\n${names}\n\nChange those items to a different unit descriptor first.`);
                return;
            }
            if (confirm(`Are you sure you want to delete the unit descriptor '${ud}'?`)) {
                unitDescriptorDatabase = unitDescriptorDatabase.filter(u => u !== ud);
                renderUnitDescriptorTable();
                renderItemTable();
                renderVarianceTable();
                saveAllDataToBrowser(false);
            }
        }

        function updateUnitDescriptorDropdown() {
            const sel = document.getElementById('unitDescriptor');
            if (!sel) return;
            const current = sel.value;
            sel.innerHTML = '';
            unitDescriptorDatabase.forEach(ud => {
                const opt = document.createElement('option');
                opt.value = ud;
                opt.textContent = ud;
                sel.appendChild(opt);
            });
            if (unitDescriptorDatabase.includes(current)) sel.value = current;
            else sel.value = 'Unit';
            updateItemFormPreview();
        }

        // --- LIVE PREVIEW TEXT FOR ITEM FORM ---
        function updateItemFormPreview() {
            const previewEl = document.getElementById('itemFormPreview');
            if (!previewEl) return;
            const name = plainText(document.getElementById('itemName')?.value) || 'This item';
            const packType = document.getElementById('packType')?.value || '';
            const units = document.getElementById('unitsPerPack')?.value || '';
            const unitSize = document.getElementById('unitSize')?.value || '';
            const unitMeasure = document.getElementById('unitMeasure')?.value || '';
            const descriptor = document.getElementById('unitDescriptor')?.value || 'Unit';
            if (!packType || !units || !unitSize || !unitMeasure) {
                previewEl.textContent = 'Fill in Pack Type, Units per Pack, Size per Unit, and Unit Measure to see a live preview here.';
                return;
            }
            const descriptorPlural = units && parseFloat(units) === 1 ? descriptor : `${descriptor}${descriptor.endsWith('s') ? '' : 's'}`;
            previewEl.textContent = `${name} ${/s$/i.test(name) ? 'are' : 'is'} received in a ${packType}. Units per pack is ${units} ${descriptor}${parseFloat(units) === 1 ? '' : 's'}, each ${descriptor} is ${unitSize} ${unitMeasure}.`;
        }

        // PROPERTIES
        function updatePropertyDropdowns() {
            const selects = ['globalPropertySelector', 'duplicateTargetSelector', 'cloneSource'];
            selects.forEach(selectId => {
                const el = document.getElementById(selectId);
                if(!el) return;
                const currentValue = el.value;
                el.innerHTML = '';
                [...propertyDatabase].sort((a, b) => a.localeCompare(b)).forEach(prop => {
                    const opt = document.createElement('option');
                    opt.value = prop;
                    opt.textContent = prop;
                    el.appendChild(opt);
                });
                if (propertyDatabase.includes(currentValue)) el.value = currentValue;
            });
            
            if (!propertyDatabase.includes(currentProperty)) {
                currentProperty = propertyDatabase[0] || "";
                document.getElementById('globalPropertySelector').value = currentProperty;
            }
            renderCloneLists();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        function renderPropertyTable() {
            const tbody = document.getElementById('propertyTableBody');
            tbody.innerHTML = '';
            
            if(propertyDatabase.length === 0) { 
                tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #777;">No properties configured. Add one above.</td></tr>`; 
                return; 
            }

    [...propertyDatabase].sort((a, b) => a.localeCompare(b)).forEach(prop => {
    const prepCount = prepDatabase.filter(p => p.property === prop).length;
    const menuCount = menuDatabase.filter(m => m.property === prop).length;
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><strong>${prop}</strong></td>
        <td>${prepCount} Prep / ${menuCount} Menu Items</td>
        <td>
            <button class="action-btn" onclick="editProperty('${prop}')">Edit</button>
            <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteProperty('${prop}')">Delete</button>
        </td>`;
    tbody.appendChild(row);
});
        }

        document.getElementById('propertyForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const oldName = document.getElementById('editPropertyOldName').value;
            const newName = plainText(document.getElementById('newPropertyName').value);
            
            if (propertyDatabase.includes(newName) && oldName !== newName) {
                alert("A property with this name already exists."); return;
            }

            if (oldName) {
                const index = propertyDatabase.indexOf(oldName);
                if (index > -1) propertyDatabase[index] = newName;
                
                prepDatabase.forEach(p => { if(p.property === oldName) p.property = newName; });
                menuDatabase.forEach(m => { if(m.property === oldName) m.property = newName; });
                propertyMenuDatabase.forEach(m => { if(m.property === oldName) m.property = newName; });
                
                if (currentProperty === oldName) currentProperty = newName;
            } else {
                propertyDatabase.push(newName);
                if (propertyDatabase.length === 1) currentProperty = newName;
            }

            cancelEditProperty();
            initSettings();
            renderPrepTable();
            renderMenuTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        });

        function editProperty(propName) {
            document.getElementById('editPropertyOldName').value = propName;
            document.getElementById('newPropertyName').value = propName;
            document.getElementById('propSubmitBtn').textContent = "Save Changes";
            document.getElementById('propCancelBtn').style.display = "block";
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function cancelEditProperty() {
            document.getElementById('propertyForm').reset();
            document.getElementById('editPropertyOldName').value = "";
            document.getElementById('propSubmitBtn').textContent = "Save Property";
            document.getElementById('propCancelBtn').style.display = "none";
        }

        function deleteProperty(propName) {
            const auth = prompt(`WARNING: You are about to permanently delete ${propName} and ALL its associated Prep and Menu recipes.\n\nTo proceed, type the property name exactly as shown below:\n\n${propName}`);
            
            if(auth === propName) {
                propertyDatabase = propertyDatabase.filter(p => p !== propName);
                prepDatabase = prepDatabase.filter(p => p.property !== propName);
                menuDatabase = menuDatabase.filter(m => m.property !== propName);
                propertyMenuDatabase = propertyMenuDatabase.filter(m => m.property !== propName);
                initSettings();
                renderPrepTable();
                renderMenuTable();
                updateMenuCategoryFilterOptions();
                renderPropertyMenus();
                renderSelectedPropertyMenuDetails();
                saveAllDataToBrowser(false);
                alert(`${propName} deleted successfully.`);
            } else if (auth !== null) {
                alert("Name did not match. Deletion cancelled to protect data.");
            }
        }

        // --- SELECTIVE CLONE LOGIC ---
        function renderCloneLists() {
            const source = document.getElementById('cloneSource').value;
            const recipeList = document.getElementById('cloneRecipeList');
            const targetList = document.getElementById('cloneTargetList');
            
            recipeList.innerHTML = '';
            targetList.innerHTML = '';

            if(!source) {
                recipeList.innerHTML = '<span style="color:#777; font-size:0.9rem;">Select a source property first.</span>';
                targetList.innerHTML = '<span style="color:#777; font-size:0.9rem;">Select a source property first.</span>';
                return;
            }

            let hasTargets = false;
            propertyDatabase.forEach(prop => {
                if(prop !== source) {
                    targetList.innerHTML += `<label><input type="checkbox" value="${prop}" class="clone-target-cb"> ${prop}</label>`;
                    hasTargets = true;
                }
            });
            if(!hasTargets) targetList.innerHTML = '<span style="color:#777; font-size:0.9rem;">No other properties exist to copy to.</span>';

            const sourcePreps = prepDatabase.filter(p => p.property === source);
            const sourceMenus = menuDatabase.filter(m => m.property === source);

            if(sourcePreps.length === 0 && sourceMenus.length === 0) {
                recipeList.innerHTML = '<span style="color:#777; font-size:0.9rem;">No recipes found in this property.</span>';
                return;
            }

            if(sourcePreps.length > 0) {
                recipeList.innerHTML += '<strong style="display:block; margin-bottom:5px; color:var(--primary);">Prep Recipes</strong>';
                sourcePreps.forEach(p => {
                    recipeList.innerHTML += `<label style="margin-left: 10px;"><input type="checkbox" value="${p.id}" data-type="prep" class="clone-recipe-cb"> ${p.name}</label>`;
                });
            }

            if(sourceMenus.length > 0) {
                recipeList.innerHTML += '<strong style="display:block; margin-top:10px; margin-bottom:5px; color:var(--primary);">Menu Items</strong>';
                sourceMenus.forEach(m => {
                    recipeList.innerHTML += `<label style="margin-left: 10px;"><input type="checkbox" value="${m.id}" data-type="menu" class="clone-recipe-cb"> ${m.name}</label>`;
                });
            }
        }

        function executeSelectiveClone() {
            const selectedTargets = Array.from(document.querySelectorAll('.clone-target-cb:checked')).map(cb => cb.value);
            const selectedRecipes = Array.from(document.querySelectorAll('.clone-recipe-cb:checked'));

            if(selectedTargets.length === 0) { showToast('Please select at least one target property.', 'warning'); return; }
            if(selectedRecipes.length === 0) { showToast('Please select at least one recipe to copy.', 'warning'); return; }

            let cloneCount = 0;
            const rnd = () => Math.random().toString(36).substr(2, 5); 

            selectedTargets.forEach(target => {
                selectedRecipes.forEach(cb => {
                    const id = cb.value;
                    const type = cb.getAttribute('data-type');

                    if(type === 'prep') {
                        const original = prepDatabase.find(p => p.id === id);
                        if(original) {
                            const clone = JSON.parse(JSON.stringify(original)); 
                            clone.id = 'PREP-' + Date.now().toString() + '-' + rnd();
                            clone.property = target;
                            prepDatabase.push(clone);
                            cloneCount++;
                        }
                    } else if (type === 'menu') {
                        const original = menuDatabase.find(m => m.id === id);
                        if(original) {
                            const clone = JSON.parse(JSON.stringify(original)); 
                            clone.id = 'MENU-' + Date.now().toString() + '-' + rnd();
                            clone.property = target;
                            menuDatabase.push(clone);
                            cloneCount++;
                        }
                    }
                });
            });

            showToast(`Copied ${cloneCount} recipe record(s) across ${selectedTargets.length} propert${selectedTargets.length > 1 ? 'ies' : 'y'}.`, 'success');
            
            document.querySelectorAll('.clone-target-cb, .clone-recipe-cb').forEach(cb => cb.checked = false);

            renderPropertyTable();
            updateMenuCategoryFilterOptions();
            if (selectedTargets.includes(currentProperty)) {
                renderPrepTable();
                renderMenuTable();
            }
            saveAllDataToBrowser(false);
        }

        // --- GLOBAL SELECTOR ---
                document.getElementById('globalPropertySelector').addEventListener('change', function(e) {
            currentProperty = e.target.value;
            updateUIPropertyNames();
            updateMenuCategoryFilterOptions();
            updateItemCategoryFilterDropdown();
            updateItemSupplierFilterDropdown();
            renderPrepTable();
            renderMenuTable();
            resetItemPagination();
            renderItemTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            renderVarianceTable();
            
            document.getElementById('prepForm').reset();
            document.getElementById('prepSteps').innerHTML = ''; // Clear RTE
            currentPrepIngredients = [];
            updatePrepIngredientTable();
            populatePrepUsageUnit();
            saveAllDataToBrowser(false);
            document.getElementById('menuForm').reset();
            currentMenuIngredients = [];
            updateMenuIngredientTable();
        });

        function updateUIPropertyNames() {
            document.querySelectorAll('.display-property-name').forEach(el => el.textContent = currentProperty);
        }

        // --- DESKTOP LAYOUT PREFERENCES ---
        const UI_LAYOUT_STORAGE_KEY = 'fb_recipe_cogs_manager_ui_layout';
        const TAB_TITLES = {'menu-builder':'Menus',items:'Item Master',prep:'Prep Recipes','menu-items':'Menu Item Recipes',hotels:'Property Management',variance:'Inventory Variance'};
        function updatePageContext(tabName){const el=document.getElementById('pageContextTitle');if(el)el.textContent=TAB_TITLES[tabName]||'F&B Manager';}
        function toggleSidebarCollapse(forceState=null){const collapsed=forceState===null?!document.body.classList.contains('sidebar-collapsed'):!!forceState;document.body.classList.toggle('sidebar-collapsed',collapsed);const btn=document.getElementById('sidebarCollapseBtn');if(btn){btn.textContent=collapsed?'▶':'◀';btn.title=collapsed?'Expand navigation':'Collapse navigation';}try{localStorage.setItem(UI_LAYOUT_STORAGE_KEY,JSON.stringify({collapsed}));}catch(err){}}
        function restoreLayoutPreference(){let collapsed=false;try{collapsed=!!JSON.parse(localStorage.getItem(UI_LAYOUT_STORAGE_KEY)||'{}').collapsed;}catch(err){}toggleSidebarCollapse(collapsed);updatePageContext(document.querySelector('.tab-content.active')?.id||'menu-builder');}
        function toggleWorkflowPanel(panelId,button){const panel=document.getElementById(panelId);if(!panel)return;const open=panel.classList.toggle('show');if(button)button.classList.toggle('open',open);}
        // --- Navigation Logic ---
        function openTab(evt, tabName) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
            const tab = document.getElementById(tabName);
            if (tab) tab.classList.add('active');
            if (evt?.currentTarget) evt.currentTarget.classList.add('active');
            updatePageContext(tabName);
            if (tabName === 'menu-builder') { renderPropertyMenuPicker(); renderPropertyMenus(); renderSelectedPropertyMenuDetails(); }
            else if (tabName === 'menu-items') { updateMenuCategoryFilterOptions(); renderMenuTable(); }
            else if (tabName === 'prep') { renderPrepTable(); }
            else if (tabName === 'variance') { renderVarianceTable(); }
        }

        function toggleDropdown(evt, menuId) {
            const menu = document.getElementById(menuId);
            if (!menu) return;
            menu.classList.toggle('show');
            if (evt?.currentTarget) evt.currentTarget.classList.toggle('open');
        }

        function togglePortionWeight() {
            const prepUnit = document.getElementById('prepUnit').value;
            const portionGroup = document.getElementById('portionWeightGroup');
            portionGroup.style.display = (prepUnit === 'Each') ? 'block' : 'none';
        }

        // --- Item Master Logic (Global) ---
        const unitMeasureSelect = document.getElementById('unitMeasure');
        const recipeMeasureSelect = document.getElementById('recipeMeasure');

        const measureOptions = {
            volume: [{ val: 'L', text: 'Liters (L)' }, { val: 'ML', text: 'Milliliters (ML)' }, { val: 'FL_OZ', text: 'Fluid Ounces (fl oz)' }, { val: 'Cups', text: 'Cups' }, { val: 'Tbsp', text: 'Tablespoons (tbsp)' }, { val: 'Tsp', text: 'Teaspoons (tsp)' }, { val: 'Each', text: 'Each (Single Unit)' }],
            weight: [{ val: 'KG', text: 'Kilograms (KG)' }, { val: 'G', text: 'Grams (G)' }, { val: 'LBS', text: 'Pounds (lbs)' }, { val: 'OZ', text: 'Ounces (oz)' }, { val: 'Each', text: 'Each (Single Unit)' }],
            each: [{ val: 'Each', text: 'Each (Single Unit)' }]
        };

        // --- CUSTOM UNIT CONVERSIONS (per-item weight<->volume<->each overrides) ---
        // Each item may store: customConversions: [{ fromQty, fromUnit, toQty, toUnit }]
        // These let an item's Recipe Measurement Unit dropdown offer a unit outside its
        // normal received family (e.g. a KG-received flour that can also be measured in Cups).
        const ALL_MEASURE_UNITS = { L:'Liters (L)', ML:'Milliliters (ML)', FL_OZ:'Fluid oz', Cups:'Cups', Tbsp:'Tbsp', Tsp:'Tsp', KG:'Kilograms (KG)', G:'Grams (G)', LBS:'Pounds (lbs)', OZ:'Ounces (oz)', Each:'Each' };

        function getCustomConversionUnitLabel(unit) {
            return ALL_MEASURE_UNITS[unit] || unit;
        }

        function populateCustomConversionUnitDropdowns(fromSelectId, toSelectId) {
            const fromSel = document.getElementById(fromSelectId);
            const toSel = document.getElementById(toSelectId);
            if (!fromSel || !toSel) return;
            const unitList = Object.keys(ALL_MEASURE_UNITS).filter(u => u !== 'Portion');
            [fromSel, toSel].forEach(sel => {
                sel.innerHTML = unitList.map(u => `<option value="${u}">${ALL_MEASURE_UNITS[u]}</option>`).join('');
            });
            fromSel.value = 'OZ';
            toSel.value = 'Cups';
        }

        function renderCustomConversionList(conversions, listElId, isEditModal) {
            const listEl = document.getElementById(listElId);
            if (!listEl) return;
            if (!Array.isArray(conversions) || conversions.length === 0) {
                listEl.innerHTML = '<div style="font-size:0.82rem; color:#888;">No custom conversions added yet.</div>';
                return;
            }
            listEl.innerHTML = conversions.map((c, idx) => `
                <div style="display:flex; align-items:center; justify-content:space-between; background:#fff; border:1px solid var(--border-color); border-radius:4px; padding:6px 10px; margin-bottom:6px; font-size:0.85rem;">
                    <span><strong>${c.fromQty} ${getCustomConversionUnitLabel(c.fromUnit)}</strong>&nbsp;=&nbsp;<strong>${c.toQty} ${getCustomConversionUnitLabel(c.toUnit)}</strong></span>
                    <button type="button" class="mini-action-btn" style="background-color:var(--cancel);" onclick="removeCustomConversion(${idx}, ${isEditModal})">Remove</button>
                </div>
            `).join('');
        }

        function addCustomConversion(isEditModal = false) {
            const prefix = isEditModal ? 'editModalCustomConv' : 'customConv';
            const listId = isEditModal ? 'editModalCustomConversionList' : 'customConversionList';
            const store = isEditModal ? editModalCustomConversions : newItemCustomConversions;

            const fromQty = parseFloat(document.getElementById(`${prefix}FromQty`).value);
            const fromUnit = document.getElementById(`${prefix}FromUnit`).value;
            const toQty = parseFloat(document.getElementById(`${prefix}ToQty`).value);
            const toUnit = document.getElementById(`${prefix}ToUnit`).value;

            if (!fromQty || !toQty || fromQty <= 0 || toQty <= 0) {
                alert('Please enter valid quantities on both sides of the conversion.');
                return;
            }
            if (fromUnit === toUnit) {
                alert('Please choose two different units to convert between.');
                return;
            }
            const duplicate = store.some(c => c.fromUnit === fromUnit && c.toUnit === toUnit);
            if (duplicate) {
                alert('A conversion between these two units already exists for this item.');
                return;
            }

            store.push({ fromQty, fromUnit, toQty, toUnit });
            renderCustomConversionList(store, listId, isEditModal);

            document.getElementById(`${prefix}FromQty`).value = '';
            document.getElementById(`${prefix}ToQty`).value = '';

            const unitMeasureVal = isEditModal ? document.getElementById('editModalUnitMeasure').value : document.getElementById('unitMeasure').value;
            const recipeSel = isEditModal ? document.getElementById('editModalRecipeMeasure') : recipeMeasureSelect;
            const currentRecipeVal = recipeSel.value;
            populateRecipeOptions(unitMeasureVal, currentRecipeVal, recipeSel, store);
        }

        function removeCustomConversion(index, isEditModal) {
            const store = isEditModal ? editModalCustomConversions : newItemCustomConversions;
            store.splice(index, 1);
            const listId = isEditModal ? 'editModalCustomConversionList' : 'customConversionList';
            renderCustomConversionList(store, listId, isEditModal);

            const unitMeasureVal = isEditModal ? document.getElementById('editModalUnitMeasure').value : document.getElementById('unitMeasure').value;
            const recipeSel = isEditModal ? document.getElementById('editModalRecipeMeasure') : recipeMeasureSelect;
            const currentRecipeVal = recipeSel.value;
            populateRecipeOptions(unitMeasureVal, currentRecipeVal, recipeSel, store);
        }

        let newItemCustomConversions = [];
        let editModalCustomConversions = [];

        unitMeasureSelect.addEventListener('change', function() { populateRecipeOptions(this.value, null, recipeMeasureSelect, newItemCustomConversions); });

        function populateRecipeOptions(selectedMeasure, presetValue = null, targetSelect = null, customConversions = []) {
            const sel = targetSelect || recipeMeasureSelect;
            sel.innerHTML = '';
            let optionsToLoad = [];
            if (['L', 'ML', 'FL_OZ'].includes(selectedMeasure)) optionsToLoad = [...measureOptions.volume];
            else if (['KG', 'G', 'LBS', 'OZ'].includes(selectedMeasure)) optionsToLoad = [...measureOptions.weight];
            else optionsToLoad = [...measureOptions.each];

            if (Array.isArray(customConversions)) {
                customConversions.forEach(c => {
                    [c.fromUnit, c.toUnit].forEach(u => {
                        if (u !== selectedMeasure && !optionsToLoad.some(o => o.val === u)) {
                            optionsToLoad.push({ val: u, text: `${getCustomConversionUnitLabel(u)} (Custom)` });
                        }
                    });
                });
            }

            optionsToLoad.forEach(opt => {
                let newOption = document.createElement('option');
                newOption.value = opt.val;
                newOption.textContent = opt.text;
                sel.appendChild(newOption);
            });
            if (presetValue) sel.value = presetValue;
        }


        // --- CENTRALIZED UNIT CONVERSION HELPERS ---
        const UNIT_CONVERSIONS = { volume: { L:1000, ML:1, FL_OZ:29.5735, Cups:250, Tbsp:15, Tsp:5 }, weight: { KG:1000, G:1, LBS:453.592, OZ:28.3495 } };
        const UNIT_LABELS = { L:'Liters (L)', ML:'Milliliters (ML)', FL_OZ:'Fluid oz', Cups:'Cups', Tbsp:'Tbsp', Tsp:'Tsp', KG:'Kilograms (KG)', G:'Grams (G)', LBS:'Pounds (lbs)', OZ:'Ounces (oz)', Each:'Each', Portion:'Portion' };
        function getUnitFamily(unit) { if (UNIT_CONVERSIONS.volume[unit]) return 'volume'; if (UNIT_CONVERSIONS.weight[unit]) return 'weight'; if (unit === 'Each' || unit === 'Portion') return 'count'; return null; }

        // Looks up a direct or inverse custom conversion ratio on an item, e.g. { fromQty:8, fromUnit:'OZ', toQty:1, toUnit:'Cups' }.
        // Returns the multiplier to convert 1 unit of fromUnit into toUnit, or null if no matching custom rule exists.
        function getCustomConversionRatio(item, fromUnit, toUnit) {
		    if (!item || !Array.isArray(item.customConversions)) return null;
		    for (const c of item.customConversions) {
		        if (c.fromUnit === fromUnit && c.toUnit === toUnit && c.fromQty > 0) {
		            return c.toQty / c.fromQty;
		        }
		        if (c.fromUnit === toUnit && c.toUnit === fromUnit && c.toQty > 0) {
		            return c.fromQty / c.toQty;
		        }
		    }
		    return null;
		}
        function canConvertUnits(fromUnit, toUnit, item = null) {
            if (item && getCustomConversionRatio(item, fromUnit, toUnit) !== null) return true;
            const a=getUnitFamily(fromUnit), b=getUnitFamily(toUnit); return !!a && a === b && a !== 'count';
        }
        // Returns the cost-per-unit multiplier between units. This supports a conversion
        // path through the item's normal unit family and then through a custom rule.
        // Example: OZ -> LBS (standard) -> Each (custom 0.715 LBS = 1 Each).
        function getUnitRatio(fromUnit, toUnit, item = null) {
            if (fromUnit === toUnit) return 1;

            const graph = new Map();
            const addEdge = (from, to, factor) => {
                if (!from || !to || !Number.isFinite(factor) || factor <= 0) return;
                if (!graph.has(from)) graph.set(from, []);
                graph.get(from).push({ unit: to, factor });
            };

            // Standard weight and volume conversions. UNIT_CONVERSIONS stores the
            // amount of the family's base unit represented by one selected unit.
            Object.values(UNIT_CONVERSIONS).forEach(family => {
                const units = Object.keys(family);
                units.forEach(from => units.forEach(to => {
                    if (from !== to) addEdge(from, to, family[to] / family[from]);
                }));
            });

            // Item-specific bridges such as 0.715 LBS = 1 Each.
            if (item && Array.isArray(item.customConversions)) {
                item.customConversions.forEach(c => {
                    const fromQty = parseFloat(c.fromQty);
                    const toQty = parseFloat(c.toQty);
                    if (!(fromQty > 0) || !(toQty > 0)) return;
                    addEdge(c.fromUnit, c.toUnit, fromQty / toQty);
                    addEdge(c.toUnit, c.fromUnit, toQty / fromQty);
                });
            }

            // Breadth-first search keeps the path short and allows standard + custom
            // conversions to be chained without treating an unsupported unit as equal.
            const queue = [{ unit: fromUnit, factor: 1 }];
            const visited = new Set([fromUnit]);
            while (queue.length) {
                const current = queue.shift();
                for (const edge of graph.get(current.unit) || []) {
                    const nextFactor = current.factor * edge.factor;
                    if (edge.unit === toUnit) return nextFactor;
                    if (!visited.has(edge.unit)) {
                        visited.add(edge.unit);
                        queue.push({ unit: edge.unit, factor: nextFactor });
                    }
                }
            }
            return null;
        }
        function convertCostPerUnit(costPerFromUnit, fromUnit, toUnit, item = null) { const ratio=getUnitRatio(fromUnit,toUnit,item); return ratio === null ? costPerFromUnit : costPerFromUnit * ratio; }
        function convertQtyUnits(qty, fromUnit, toUnit, item = null) { if (fromUnit === toUnit) return qty; const ratio = getUnitRatio(toUnit, fromUnit, item); return ratio === null ? qty : qty * ratio; }
        function getCompatibleUnits(unit, item = null) {
            const f=getUnitFamily(unit);
            let units = [];
            if (f === 'volume') units = Object.keys(UNIT_CONVERSIONS.volume);
            else if (f === 'weight') units = Object.keys(UNIT_CONVERSIONS.weight);
            else units = ['Each'];
            if (item && Array.isArray(item.customConversions)) {
                item.customConversions.forEach(c => {
                    [c.fromUnit, c.toUnit].forEach(u => { if (!units.includes(u)) units.push(u); });
                });
            }
            return units;
        }
        function calculateUnitCost(item) {
            if (!item) return null;
            const cost = parseFloat(item.cost || 0), units = parseFloat(item.units || 0), totalYield = parseFloat(item.totalYield || 0);
            const yieldFactor = (parseFloat(item.yieldPct || 100) || 100) / 100;
            if (item.recipeMeasure === 'Each') return units > 0 ? cost / units : null;
            if (!totalYield || !item.unitMeasure || !item.recipeMeasure) return null;
            if (item.unitMeasure !== item.recipeMeasure && !canConvertUnits(item.unitMeasure, item.recipeMeasure, item)) return null;
            const usableYield = totalYield * yieldFactor;
            if (!usableYield) return null;
            return convertCostPerUnit(cost / usableYield, item.unitMeasure, item.recipeMeasure, item);
        }


        // --- LIVE COST HELPERS ---
        // These functions force recipes to always look up the CURRENT Item Master cost.
        // This prevents recipes from keeping an old frozen ingredient price.
        function getRawItemUnitCostForRecipeUnit(itemId, selectedUnit) {
            const item = itemDatabase.find(i => i.id === itemId);
            if (!item) return 0;
            const baseCost = calculateUnitCost(item);
            if (baseCost === null) return 0;
            return convertCostPerUnit(baseCost, item.recipeMeasure, selectedUnit || item.recipeMeasure, item);
        }

        function getLiveIngredientTotalCost(ing, seenPrepIds = new Set()) {
            if (!ing) return 0;
            const qty = parseFloat(ing.qty || 0);
            if (ing.type === 'raw') return qty * getRawItemUnitCostForRecipeUnit(ing.itemId, ing.unit);
            if (ing.type === 'prep') {
                const prep = prepDatabase.find(p => p.id === ing.itemId);
                if (!prep) return parseFloat(ing.totalCost || 0);
                const selectedUnit = ing.unit === 'Portion' ? prep.yieldUnit : ing.unit;
                return qty * convertCostPerUnit(calculatePrepCostPerUnit(prep, seenPrepIds), prep.yieldUnit, selectedUnit);
            }
            return parseFloat(ing.totalCost || 0);
        }

        function calculatePrepTotalCost(prep, seenPrepIds = new Set()) {
            if (!prep || !Array.isArray(prep.ingredients)) return 0;
            if (seenPrepIds.has(prep.id)) return parseFloat(prep.totalCost || 0);
            const nextSeen = new Set(seenPrepIds);
            nextSeen.add(prep.id);
            return prep.ingredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing, nextSeen), 0);
        }

        function calculatePrepCostPerUnit(prep, seenPrepIds = new Set()) {
            const yieldAmount = parseFloat(prep?.yieldAmount || 0);
            if (!yieldAmount) return 0;
            return calculatePrepTotalCost(prep, seenPrepIds) / yieldAmount;
        }

        // --- INVENTORY VARIANCE ENGINE ---
        function accumulateIngredientUsage(ing, multiplier, usageMap, seenPrepIds = new Set()) {
            if (!ing) return;
            const qty = parseFloat(ing.qty) || 0;
            if (!qty || !multiplier) return;

            if (ing.type === 'raw') {
                const item = itemDatabase.find(i => i.id === ing.itemId);
                if (!item || item.excludeFromVariance) return;
                const qtyInRecipeUnit = convertQtyUnits(qty, ing.unit, item.recipeMeasure);
                const totalQty = qtyInRecipeUnit * multiplier;
                if (!usageMap[item.id]) usageMap[item.id] = { itemId: item.id, theoreticalQty: 0 };
                usageMap[item.id].theoreticalQty += totalQty;
                return;
            }

            if (ing.type === 'prep') {
                const prep = prepDatabase.find(p => p.id === ing.itemId);
                if (!prep || seenPrepIds.has(prep.id)) return;
                const nextSeen = new Set(seenPrepIds);
                nextSeen.add(prep.id);

                const prepUnit = ing.unit === 'Portion' ? prep.yieldUnit : ing.unit;
                const qtyInYieldUnit = convertQtyUnits(qty, prepUnit, prep.yieldUnit);
                const totalPrepQtyNeeded = qtyInYieldUnit * multiplier;
                const yieldAmount = parseFloat(prep.yieldAmount) || 0;
                if (!yieldAmount) return;
                const batchMultiplier = totalPrepQtyNeeded / yieldAmount;

                (prep.ingredients || []).forEach(subIng => {
                    accumulateIngredientUsage(subIng, batchMultiplier, usageMap, nextSeen);
                });
            }
        }

        function calculateTheoreticalUsageForProperty(property) {
            const usageMap = {};
            const menus = propertyMenuDatabase.filter(m => m.property === property);
            menus.forEach(menu => {
                menu.categories.forEach(category => {
                    (category.items || []).forEach(line => {
                        const soldQty = parseFloat(line.soldQty) || 0;
                        if (!soldQty) return;
                        const recipe = menuDatabase.find(m => m.id === line.recipeId && m.property === property);
                        if (!recipe || !Array.isArray(recipe.ingredients)) return;
                        recipe.ingredients.forEach(ing => {
                            accumulateIngredientUsage(ing, soldQty, usageMap, new Set());
                        });
                    });
                });
            });
            return usageMap;
        }

        function convertPurchaseToRecipeUnits(item, cases, packQty) {
            if (!item) return 0;
            const casesNum = parseFloat(cases) || 0;
            const packQtyNum = parseFloat(packQty) || 0;
            const unitsPerPack = parseFloat(item.units) || 1;
            const unitSize = parseFloat(item.unitSize) || 1;
            const yieldFactor = (parseFloat(item.yieldPct) || 100) / 100;

            const totalPackUnits = (casesNum * unitsPerPack) + packQtyNum;
            const qtyInUnitMeasure = totalPackUnits * unitSize;
            const qtyInRecipeUnit = convertQtyUnits(qtyInUnitMeasure, item.unitMeasure, item.recipeMeasure);
            return qtyInRecipeUnit * yieldFactor;
        }

        function getInventoryEntry(property, itemId) {
            if (!inventoryCountDatabase[property]) inventoryCountDatabase[property] = {};
            if (!inventoryCountDatabase[property][itemId]) {
                inventoryCountDatabase[property][itemId] = {
                    opening: { cases: 0, packQty: 0 },
                    closing: { cases: 0, packQty: 0 },
                    purchases: [{ cases: 0, packQty: 0 }]
                };
            }
            const entry = inventoryCountDatabase[property][itemId];
            if (!entry.opening || typeof entry.opening !== 'object') entry.opening = { cases: parseFloat(entry.opening) || 0, packQty: 0 };
            if (!entry.closing || typeof entry.closing !== 'object') entry.closing = { cases: parseFloat(entry.closingQty) || 0, packQty: 0 };
            if (!Array.isArray(entry.purchases) || entry.purchases.length === 0) entry.purchases = [{ cases: 0, packQty: 0 }];
            return entry;
        }

        function calculateActualUsage(property, item) {
            const entry = getInventoryEntry(property, item.id);
            const openingQty = convertPurchaseToRecipeUnits(item, entry.opening.cases, entry.opening.packQty);
            const closingQty = convertPurchaseToRecipeUnits(item, entry.closing.cases, entry.closing.packQty);
            const purchasedQty = (entry.purchases || []).reduce((sum, p) => sum + convertPurchaseToRecipeUnits(item, p.cases, p.packQty), 0);
            return openingQty + purchasedQty - closingQty;
        }

        function calculateVariance() {
            const rows = getVarianceScopeItems();
            const cache = {};
            rows.forEach(r => { cache[r.item.id] = r; });
            varianceCalcCache[currentProperty] = cache;
            varianceLastCalculated[currentProperty] = new Date().toISOString();
            renderVarianceTable();
            saveAllDataToBrowser(false);
            showToast('Variance calculated.', 'success');
        }

        function getVarianceScopeItems() {
            const usageMap = calculateTheoreticalUsageForProperty(currentProperty);
            const usedItemIds = new Set(Object.keys(usageMap));
            return itemDatabase.filter(item => usedItemIds.has(item.id)).map(item => {
                const theoreticalQty = usageMap[item.id]?.theoreticalQty || 0;
                const actualQty = calculateActualUsage(currentProperty, item);
                const varianceQty = actualQty - theoreticalQty;
                const costPerUnit = calculateUnitCost(item) || 0;
                const varianceCost = varianceQty * costPerUnit;
                return { item, theoreticalQty, actualQty, varianceQty, varianceCost, costPerUnit };
            });
        }

        function traceItemUsageInIngredient(ing, targetItemId, multiplier, pathLabel, results, seenPrepIds = new Set()) {
            if (!ing) return;
            const qty = parseFloat(ing.qty) || 0;
            if (!qty || !multiplier) return;

            if (ing.type === 'raw') {
                if (ing.itemId !== targetItemId) return;
                const item = itemDatabase.find(i => i.id === targetItemId);
                if (!item) return;
                const qtyInRecipeUnit = convertQtyUnits(qty, ing.unit, item.recipeMeasure);
                results.push({
                    path: pathLabel,
                    qtyPerUnit: qty,
                    unit: ing.unit,
                    qtyInRecipeUnitPerUnit: qtyInRecipeUnit,
                    totalTheoreticalQty: qtyInRecipeUnit * multiplier
                });
                return;
            }

            if (ing.type === 'prep') {
                const prep = prepDatabase.find(p => p.id === ing.itemId);
                if (!prep || seenPrepIds.has(prep.id) || !Array.isArray(prep.ingredients)) return;
                const nextSeen = new Set(seenPrepIds);
                nextSeen.add(prep.id);

                const prepUnit = ing.unit === 'Portion' ? prep.yieldUnit : ing.unit;
                const qtyInYieldUnit = convertQtyUnits(qty, prepUnit, prep.yieldUnit);
                const totalPrepQtyNeeded = qtyInYieldUnit * multiplier;
                const yieldAmount = parseFloat(prep.yieldAmount) || 0;
                if (!yieldAmount) return;
                const batchMultiplier = totalPrepQtyNeeded / yieldAmount;

                const nextPath = pathLabel ? `${pathLabel} → ${prep.name}` : prep.name;
                prep.ingredients.forEach(subIng => {
                    traceItemUsageInIngredient(subIng, targetItemId, batchMultiplier, nextPath, results, nextSeen);
                });
            }
        }

        // Show every saved recipe across all properties that depends on a raw Item Master item.
        function findRawItemPathsInIngredients(ingredients, targetItemId, property, seenPrepIds = new Set(), path = []) {
            const matches = [];
            (ingredients || []).forEach(ing => {
                if (!ing) return;
                if (ing.type === 'raw' && ing.itemId === targetItemId) {
                    matches.push({ path: path.length ? path.join(' → ') : 'Direct ingredient', qty: ing.qty, unit: ing.unit });
                    return;
                }
                if (ing.type !== 'prep' || seenPrepIds.has(ing.itemId)) return;
                const prep = prepDatabase.find(p => p.id === ing.itemId && (!property || p.property === property));
                if (!prep) return;
                const nextSeen = new Set(seenPrepIds);
                nextSeen.add(prep.id);
                matches.push(...findRawItemPathsInIngredients(prep.ingredients, targetItemId, property, nextSeen, [...path, prep.name]));
            });
            return matches;
        }

        function getItemRecipeUsageAcrossProperties(itemId) {
            const usage = [];
            prepDatabase.forEach(prep => {
                findRawItemPathsInIngredients(prep.ingredients, itemId, prep.property, new Set([prep.id])).forEach(match => usage.push({
                    property: prep.property || 'Unassigned', recipeType: 'Prep Recipe', recipeName: prep.name || 'Unnamed Prep Recipe',
                    recipeId: prep.id, path: match.path, qty: match.qty, unit: match.unit
                }));
            });
            menuDatabase.forEach(menu => {
                findRawItemPathsInIngredients(menu.ingredients, itemId, menu.property).forEach(match => usage.push({
                    property: menu.property || 'Unassigned', recipeType: 'Menu Item Recipe', recipeName: menu.name || 'Unnamed Menu Item',
                    recipeId: menu.id, path: match.path, qty: match.qty, unit: match.unit
                }));
            });
            return usage.sort((a, b) => a.property.localeCompare(b.property) || a.recipeType.localeCompare(b.recipeType) || a.recipeName.localeCompare(b.recipeName) || a.path.localeCompare(b.path));
        }

        function openItemRecipeUsage(itemId) {
            const item = itemDatabase.find(i => i.id === itemId);
            if (!item) return;
            const rows = getItemRecipeUsageAcrossProperties(itemId);
            const title = document.getElementById('itemDrilldownTitle');
            const body = document.getElementById('itemDrilldownBody');
            if (title) title.textContent = `Recipe Usage for "${item.name}"`;
            if (!rows.length) {
                body.innerHTML = `<div class="recipe-meta-card" style="margin-bottom:15px;"><strong>No recipe usage found</strong>This item is not currently used in any saved Prep Recipe or Menu Item Recipe.</div>`;
            } else {
                const propertyCount = new Set(rows.map(r => r.property)).size;
                const recipeCount = new Set(rows.map(r => `${r.recipeType}:${r.recipeId}`)).size;
                const tableRows = rows.map(r => `<tr><td><strong>${escapeHtml(r.property)}</strong></td><td>${escapeHtml(r.recipeType)}</td><td><strong>${escapeHtml(r.recipeName)}</strong></td><td>${r.path === 'Direct ingredient' ? 'Direct ingredient' : `Via ${escapeHtml(r.path)}`}</td><td>${escapeHtml(r.qty)} ${escapeHtml(r.unit)}</td></tr>`).join('');
                body.innerHTML = `<p style="color:#666;margin-top:-5px;">Includes direct use and menu items that depend on this item through a Prep Recipe.</p><div class="recipe-meta-grid"><div class="recipe-meta-card"><strong>Properties</strong>${propertyCount}</div><div class="recipe-meta-card"><strong>Recipes Affected</strong>${recipeCount}</div><div class="recipe-meta-card"><strong>Usage Lines</strong>${rows.length}</div><div class="recipe-meta-card"><strong>Current Recipe Unit</strong>${escapeHtml(item.recipeMeasure || '—')}</div></div><table><thead><tr><th>Property</th><th>Recipe Type</th><th>Recipe</th><th>Used</th><th>Qty / Unit</th></tr></thead><tbody>${tableRows}</tbody></table>`;
            }
            document.getElementById('itemDrilldownModal').style.display = 'block';
        }

        function computeItemUsageBreakdown(itemId, property) {
            const rows = [];
            const menus = propertyMenuDatabase.filter(m => m.property === property);
            menus.forEach(menu => {
                menu.categories.forEach(category => {
                    (category.items || []).forEach(line => {
                        const soldQty = parseFloat(line.soldQty) || 0;
                        if (!soldQty) return;
                        const recipe = menuDatabase.find(m => m.id === line.recipeId && m.property === property);
                        if (!recipe || !Array.isArray(recipe.ingredients)) return;

                        const results = [];
                        recipe.ingredients.forEach(ing => {
                            traceItemUsageInIngredient(ing, itemId, soldQty, '', results, new Set());
                        });

                        results.forEach(r => {
                            rows.push({
                                menuItemName: recipe.name,
                                category: category.name,
                                soldQty,
                                path: r.path || 'Direct ingredient',
                                qtyPerUnit: r.qtyPerUnit,
                                unit: r.unit,
                                qtyInRecipeUnitPerUnit: r.qtyInRecipeUnitPerUnit,
                                totalTheoreticalQty: r.totalTheoreticalQty
                            });
                        });
                    });
                });
            });
            rows.sort((a, b) => b.totalTheoreticalQty - a.totalTheoreticalQty);
            return rows;
        }

        function openItemDrilldown(itemId) {
            const item = itemDatabase.find(i => i.id === itemId);
            if (!item) return;
            const rows = computeItemUsageBreakdown(itemId, currentProperty);
            const title = document.getElementById('itemDrilldownTitle');
            const body = document.getElementById('itemDrilldownBody');
            if (title) title.textContent = `Where "${item.name}" Is Used — ${currentProperty}`;

            const totalTheoretical = rows.reduce((sum, r) => sum + r.totalTheoreticalQty, 0);

            if (rows.length === 0) {
                body.innerHTML = `<p style="color:#777;">No menu items with Sold Qty currently use this item for ${escapeHtml(currentProperty)}.</p>`;
            } else {
                const tableRows = rows.map(r => {
				  const effectiveQty = r.soldQty ? (r.totalTheoreticalQty / r.soldQty) : 0;
				  const isViaPrep = r.path && r.path !== 'Direct ingredient';
				  const qtyCell = isViaPrep
					? `${effectiveQty.toFixed(2)} ${escapeHtml(item.recipeMeasure)}
					   <br><span style="font-size:0.7rem;color:#aaa">(recipe batch calls for ${r.qtyPerUnit} ${escapeHtml(r.unit)})</span>`
					: `${r.qtyPerUnit} ${escapeHtml(r.unit)}`;
				  return `
					<tr>
					  <td><strong>${escapeHtml(r.menuItemName)}</strong><br>
					  <span style="font-size:0.75rem;color:#7f8c8d">${escapeHtml(r.category)}</span></td>
					  <td>${escapeHtml(r.path)}</td>
					  <td>${qtyCell}</td>
					  <td>${r.soldQty}</td>
					  <td style="font-weight:bold;color:var(--primary)">${r.totalTheoreticalQty.toFixed(2)} ${escapeHtml(item.recipeMeasure)}</td>
					</tr>
				  `;
				}).join('');

                body.innerHTML = `
                    <p style="color:#7f8c8d;font-size:0.85rem;margin-top:-5px;">Theoretical usage is driven by Sold Qty on your Menu Builder. Items used only inside a Prep Recipe show the full path (e.g., Prep Name → Menu Item).</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Menu Item</th>
                                <th>Used Via</th>
                                <th>Qty Used Per Sold Unit</th>
                                <th>Sold Qty</th>
                                <th>Theoretical Usage</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                        <tfoot>
                            <tr style="background-color:#e9ecef;font-weight:bold;">
                                <td colspan="4" style="text-align:right;">Total Theoretical Usage</td>
                                <td style="color:var(--primary);">${totalTheoretical.toFixed(2)} ${escapeHtml(item.recipeMeasure)}</td>
                            </tr>
                        </tfoot>
                    </table>`;
            }

            document.getElementById('itemDrilldownModal').style.display = 'block';
        }

        function renderVarianceTable() {
            const tbody = document.getElementById('varianceTableBody');
            if (!tbody) return;
            const sortMode = document.getElementById('varianceSortMode')?.value || 'qty-high-low';
            const searchText = (document.getElementById('varianceSearchInput')?.value || '').toLowerCase();
            const cache = varianceCalcCache[currentProperty] || {};

            const usageMap = calculateTheoreticalUsageForProperty(currentProperty);
            const usedItemIds = new Set(Object.keys(usageMap));
            let items = itemDatabase.filter(item => usedItemIds.has(item.id));
            if (searchText) items = items.filter(item => (item.name || '').toLowerCase().includes(searchText));

            let rows = items.map(item => {
                const cached = cache[item.id];
                return {
                    item,
                    theoreticalQty: usageMap[item.id]?.theoreticalQty || 0,
                    hasCalc: !!cached,
                    actualQty: cached ? cached.actualQty : null,
                    varianceQty: cached ? cached.varianceQty : null,
                    varianceCost: cached ? cached.varianceCost : null,
                    costPerUnit: cached ? cached.costPerUnit : (calculateUnitCost(item) || 0)
                };
            });

            if (sortMode === 'alpha') rows.sort((a, b) => a.item.name.localeCompare(b.item.name));
            else if (sortMode === 'qty-high-low') rows.sort((a, b) => (b.varianceQty ?? -Infinity) - (a.varianceQty ?? -Infinity));
            else if (sortMode === 'qty-low-high') rows.sort((a, b) => (a.varianceQty ?? Infinity) - (b.varianceQty ?? Infinity));
            else if (sortMode === 'cost-high-low') rows.sort((a, b) => (b.varianceCost ?? -Infinity) - (a.varianceCost ?? -Infinity));
            else if (sortMode === 'cost-low-high') rows.sort((a, b) => (a.varianceCost ?? Infinity) - (b.varianceCost ?? Infinity));
            else if (sortMode === 'top15-bottom10-dollar') {
                const sorted = [...rows].sort((a, b) => (b.varianceCost ?? -Infinity) - (a.varianceCost ?? -Infinity));
                const top = sorted.slice(0, 15);
                const bottom = sorted.slice(-10).reverse();
                rows = [...top, ...bottom];
            } else if (sortMode === 'top15-bottom10-qty') {
                const sorted = [...rows].sort((a, b) => (b.varianceQty ?? -Infinity) - (a.varianceQty ?? -Infinity));
                const top = sorted.slice(0, 15);
                const bottom = sorted.slice(-10).reverse();
                rows = [...top, ...bottom];
            }

            const lastCalcEl = document.getElementById('varianceLastCalculated');
            if (lastCalcEl) {
                const ts = varianceLastCalculated[currentProperty];
                lastCalcEl.textContent = ts
                    ? `Last calculated: ${new Date(ts).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                    : 'Not yet calculated for this property.';
            }

            lastRenderedVarianceRows = rows;

            tbody.innerHTML = '';
            if (rows.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#777;">No used items found for ${escapeHtml(currentProperty)}${searchText ? ' matching your search' : ''}. Sell menu items with Sold Qty entered first.</td></tr>`;
                return;
            }

            rows.forEach(r => {
                const entry = getInventoryEntry(currentProperty, r.item.id);
                const p0 = entry.purchases[0] || { cases: 0, packQty: 0 };
                const descriptor = r.item.unitDescriptor || 'Unit';
                const packPlaceholder = `+${descriptor}/Pk`;
                const varianceColor = !r.hasCalc ? '#aaa' : (r.varianceQty > 0 ? '#e74c3c' : (r.varianceQty < 0 ? '#3498db' : '#18bc9c'));
                const varianceQtyDisplay = r.hasCalc ? `${r.varianceQty >= 0 ? '+' : ''}${r.varianceQty.toFixed(2)} ${escapeHtml(r.item.recipeMeasure)}` : '\u2014';
                const varianceCostDisplay = r.hasCalc ? `${r.varianceCost >= 0 ? '+' : ''}$${r.varianceCost.toFixed(2)}` : '\u2014';
                const actualQtyDisplay = r.hasCalc ? `${r.actualQty.toFixed(2)} ${escapeHtml(r.item.recipeMeasure)}` : '\u2014';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong style="cursor:pointer;color:#2980b9;text-decoration:underline;" onclick="openItemDrilldown('${r.item.id}')" title="Click to see which recipes use this item">${escapeHtml(r.item.name)}</strong><br><span style="font-size:0.75rem;color:#7f8c8d;">${escapeHtml(r.item.packType || '')} ${r.item.units || ''} ${escapeHtml(descriptor)}${(parseFloat(r.item.units) === 1) ? '' : 's'} x ${r.item.unitSize || ''} ${escapeHtml(r.item.unitMeasure || '')}</span></td>
                    <td>${r.theoreticalQty.toFixed(2)} ${escapeHtml(r.item.recipeMeasure)}</td>
                    <td style="white-space:nowrap;">
                        <input type="number" step="0.01" placeholder="Cases" value="${entry.opening.cases || ''}" style="width:65px" oninput="updateInventoryField('${r.item.id}','opening','cases',this.value)">
                        <input type="number" step="0.01" placeholder="${escapeHtml(packPlaceholder)}" title="${escapeHtml(descriptor)}s per case" value="${entry.opening.packQty || ''}" style="width:70px" oninput="updateInventoryField('${r.item.id}','opening','packQty',this.value)">
                    </td>
                    <td style="white-space:nowrap;">
                        <input type="number" step="0.01" placeholder="Cases" value="${p0.cases || ''}" style="width:65px" oninput="updatePurchaseField('${r.item.id}',0,'cases',this.value)">
                        <input type="number" step="0.01" placeholder="${escapeHtml(packPlaceholder)}" title="${escapeHtml(descriptor)}s per case" value="${p0.packQty || ''}" style="width:70px" oninput="updatePurchaseField('${r.item.id}',0,'packQty',this.value)">
                    </td>
                    <td style="white-space:nowrap;">
                        <input type="number" step="0.01" placeholder="Cases" value="${entry.closing.cases || ''}" style="width:65px" oninput="updateInventoryField('${r.item.id}','closing','cases',this.value)">
                        <input type="number" step="0.01" placeholder="${escapeHtml(packPlaceholder)}" title="${escapeHtml(descriptor)}s per case" value="${entry.closing.packQty || ''}" style="width:70px" oninput="updateInventoryField('${r.item.id}','closing','packQty',this.value)">
                    </td>
                    <td>${actualQtyDisplay}</td>
                    <td style="font-weight:bold;color:${varianceColor}">${varianceQtyDisplay}</td>
                    <td>$${r.costPerUnit.toFixed(4)}</td>
                    <td style="font-weight:bold;color:${varianceColor}">${varianceCostDisplay}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        function updateInventoryField(itemId, section, subField, value) {
            const entry = getInventoryEntry(currentProperty, itemId);
            if (!entry[section] || typeof entry[section] !== 'object') entry[section] = { cases: 0, packQty: 0 };
            entry[section][subField] = parseFloat(value) || 0;
            debouncedSaveVariance();
        }

        function updatePurchaseField(itemId, index, field, value) {
            const entry = getInventoryEntry(currentProperty, itemId);
            if (!entry.purchases[index]) entry.purchases[index] = { cases: 0, packQty: 0 };
            entry.purchases[index][field] = parseFloat(value) || 0;
            debouncedSaveVariance();
        }

        const debouncedSaveVariance = debounce(() => saveAllDataToBrowser(false), 400);

        function resetVarianceCounts() {
            const propEntries = inventoryCountDatabase[currentProperty] || {};
            const hasClosingData = Object.values(propEntries).some(e => (parseFloat(e?.closing?.cases) || 0) !== 0 || (parseFloat(e?.closing?.packQty) || 0) !== 0);

            const transfer = hasClosingData
                ? confirm(`Transfer your Closing Inventory counts to Opening Inventory for ${currentProperty} before resetting?\n\nClick OK to carry Closing forward into the new Opening counts (recommended when starting a new count period).\nClick Cancel to reset everything to zero instead.`)
                : false;

            if (!confirm(`Reset Purchases and Closing entries for ${currentProperty}${transfer ? ' (Opening will be carried forward from Closing)' : ''}? This cannot be undone.`)) return;

            const newPropEntries = {};
            Object.keys(propEntries).forEach(itemId => {
                const entry = propEntries[itemId];
                newPropEntries[itemId] = {
                    opening: transfer ? { cases: entry.closing.cases || 0, packQty: entry.closing.packQty || 0 } : { cases: 0, packQty: 0 },
                    closing: { cases: 0, packQty: 0 },
                    purchases: [{ cases: 0, packQty: 0 }]
                };
            });
            inventoryCountDatabase[currentProperty] = newPropEntries;
            varianceCalcCache[currentProperty] = {};
            delete varianceLastCalculated[currentProperty];
            renderVarianceTable();
            saveAllDataToBrowser(false);
            showToast(transfer ? 'Closing counts carried forward to Opening. Purchases and Closing reset.' : 'All counts reset for ' + currentProperty + '.', 'success');
        }

        function printVarianceReport() {
            renderVarianceTable();
            const rows = lastRenderedVarianceRows;
            const sortModeEl = document.getElementById('varianceSortMode');
            const sortLabel = sortModeEl ? sortModeEl.options[sortModeEl.selectedIndex].textContent : '';
            const searchText = document.getElementById('varianceSearchInput')?.value || '';
            const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            const bodyRows = rows.map(r => `
                <tr>
                    <td>${escapeHtml(r.item.name)}</td>
                    <td>${r.theoreticalQty.toFixed(2)} ${escapeHtml(r.item.recipeMeasure)}</td>
                    <td>${r.hasCalc ? r.actualQty.toFixed(2) + ' ' + escapeHtml(r.item.recipeMeasure) : '\u2014'}</td>
                    <td>${r.hasCalc ? (r.varianceQty >= 0 ? '+' : '') + r.varianceQty.toFixed(2) + ' ' + escapeHtml(r.item.recipeMeasure) : '\u2014'}</td>
                    <td>$${r.costPerUnit.toFixed(4)}</td>
                    <td>${r.hasCalc ? (r.varianceCost >= 0 ? '+' : '') + '$' + r.varianceCost.toFixed(2) : '\u2014'}</td>
                </tr>`).join('');

            const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
                <title>${currentProperty} \u2014 Inventory Variance Report</title>
                <style>
                    body { font-family: 'Segoe UI', sans-serif; margin: 30px; color: #000; }
                    h1 { font-size: 1.4rem; margin-bottom: 2px; }
                    .subtitle { font-size: 0.9rem; margin-bottom: 20px; }
                    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
                    th { border-bottom: 2px solid #000; padding: 8px 10px; text-align: left; }
                    td { padding: 6px 10px; border-bottom: 1px solid #ccc; }
                    @media print { button { display:none; } }
                </style>
                </head><body>
                <h1>${currentProperty} \u2014 Inventory Variance Report</h1>
                <div class="subtitle">Generated ${date} \u2014 ${escapeHtml(sortLabel)}${searchText ? (' \u2014 Filtered by "' + escapeHtml(searchText) + '"') : ''}</div>
                <table>
                    <thead><tr><th>Item</th><th>Theoretical Usage</th><th>Actual Usage</th><th>Variance (Qty)</th><th>Cost / Unit</th><th>Variance ($)</th></tr></thead>
                    <tbody>${bodyRows}</tbody>
                </table>
                <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 100); }; window.onafterprint = function(){ setTimeout(function(){ window.close(); }, 150); };</script>
                </body></html>`;
            const w = window.open('', '_blank');
            w.document.write(html);
            w.document.close();
        }

        function calculateMenuFoodCost(menu) {
            if (!menu || !Array.isArray(menu.ingredients)) return 0;
            return menu.ingredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
        }

        function calculateMenuCostPercentage(menu) {
            const price = parseFloat(menu?.targetPrice || 0);
            if (!price) return 0;
            return (calculateMenuFoodCost(menu) / price) * 100;
        }

        // --- CREDIT INGREDIENT HELPERS ---
        // Credit ingredients (negative qty) are used to net cost/usage behind the scenes,
        // but must be hidden from kitchen-facing and manager-facing exports.
        function isCreditIngredient(ing) {
            return parseFloat(ing?.qty || 0) < 0;
        }

        function getNonCreditIngredients(menu) {
            if (!menu || !Array.isArray(menu.ingredients)) return [];
            return menu.ingredients.filter(ing => !isCreditIngredient(ing));
        }

        function calculateMenuFoodCostExcludingCredits(menu) {
            if (!menu || !Array.isArray(menu.ingredients)) return 0;
            return getNonCreditIngredients(menu).reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
        }

        function calculateMenuCostPercentageExcludingCredits(menu) {
            const price = parseFloat(menu?.targetPrice || 0);
            if (!price) return 0;
            return (calculateMenuFoodCostExcludingCredits(menu) / price) * 100;
        }

        // --- EXPORT FRESHNESS HELPERS ---
        function syncCurrentMenuEditBeforeExport(menuId = null) {
            const editId = document.getElementById('editMenuId')?.value || '';
            if (!editId || (menuId && editId !== menuId)) return null;
            const existing = menuDatabase.find(m => m.id === editId) || {};
            const name = plainText(document.getElementById('menuItemName')?.value || existing.name || '');
            const category = document.getElementById('menuCategory')?.value || existing.category || '';
            const targetPrice = parseFloat(document.getElementById('menuPrice')?.value || existing.targetPrice || 0);
            const steps = cleanRichText(document.getElementById('menuSteps')?.innerHTML || existing.steps || '');
            const tipsNotes = cleanRichText(document.getElementById('menuTipsNotes')?.innerHTML || existing.tipsNotes || '');
            const cookTime = plainText(document.getElementById('cookTime')?.value || existing.cookTime || '');
            const ingredients = Array.isArray(currentMenuIngredients) ? [...currentMenuIngredients] : [...(existing.ingredients || [])];
            const foodCost = ingredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
            const costPercentage = targetPrice > 0 ? (foodCost / targetPrice) * 100 : 0;
            const menuData = { ...existing, id: editId, property: currentProperty || existing.property, name, category, targetPrice, foodCost, costPercentage, steps, tipsNotes, cookTime, ingredients };
            const idx = menuDatabase.findIndex(m => m.id === editId);
            if (idx > -1) menuDatabase[idx] = menuData;
            else menuDatabase.push(menuData);
            saveAllDataToBrowser(false);
            renderMenuTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            return menuData;
        }
        function getMenuForExport(menuId) {
            const fresh = syncCurrentMenuEditBeforeExport(menuId);
            return fresh || menuDatabase.find(m => m.id === menuId);
        }
        function syncCurrentPrepEditBeforeExport(prepId = null) {
            const editId = document.getElementById('editPrepId')?.value || '';
            if (!editId || (prepId && editId !== prepId)) return null;
            const existing = prepDatabase.find(p => p.id === editId) || {};
            const name = plainText(document.getElementById('prepName')?.value || existing.name || '');
            const yieldAmount = parseFloat(document.getElementById('prepYield')?.value || existing.yieldAmount || 0);
            const yieldUnit = document.getElementById('prepUnit')?.value || existing.yieldUnit || '';
            const shelfLife = plainText(document.getElementById('prepShelfLife')?.value || existing.shelfLife || '');
            const usage = plainText(document.getElementById('prepUsage')?.value || existing.usage || '');
            const usageUnit = document.getElementById('prepUsageUnit')?.value || existing.usageUnit || '';
            const steps = cleanRichText(document.getElementById('prepSteps')?.innerHTML || existing.steps || '');
            let portionWeight = existing.portionWeight || null;
            let portionUnit = existing.portionUnit || null;
            if (yieldUnit === 'Each') {
                portionWeight = parseFloat(document.getElementById('prepPortionWeight')?.value || existing.portionWeight || 0);
                portionUnit = document.getElementById('prepPortionUnit')?.value || existing.portionUnit || 'OZ';
            }
            const ingredients = Array.isArray(currentPrepIngredients) ? [...currentPrepIngredients] : [...(existing.ingredients || [])];
            const totalCost = ingredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
            const costPerUnit = yieldAmount ? totalCost / yieldAmount : 0;
            const prepData = { ...existing, id: editId, property: currentProperty || existing.property, name, yieldAmount, yieldUnit, shelfLife, usage, usageUnit, steps, portionWeight, portionUnit, totalCost, costPerUnit, ingredients };
            const idx = prepDatabase.findIndex(p => p.id === editId);
            if (idx > -1) prepDatabase[idx] = prepData;
            else prepDatabase.push(prepData);
            saveAllDataToBrowser(false);
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            return prepData;
        }
        function getPrepForExport(prepId) {
            const fresh = syncCurrentPrepEditBeforeExport(prepId);
            return fresh || prepDatabase.find(p => p.id === prepId);
        }


        function formatPriceUpdatedDate(value) {
            if (!value) return 'No price update recorded yet.';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return `Last price update: ${value}`;
            return `Last price update: ${d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}`;
        }
        function refreshPriceUpdatedDisplay(value = '') {
            const display = document.getElementById('priceLastUpdatedDisplay');
            const hidden = document.getElementById('itemPriceLastUpdated');
            if (hidden) hidden.value = value || '';
            if (display) display.textContent = formatPriceUpdatedDate(value);
        }
        function updateItemPriceFromEdit() {
            const id = document.getElementById('editItemId')?.value || '';
            if (!id) { showToast('Open an existing item first, then use Update Price.', 'warning'); return; }
            const item = itemDatabase.find(i => i.id === id);
            if (!item) return;
            const newCost = parseFloat(document.getElementById('invoiceCost')?.value || 0);
            if (!Number.isFinite(newCost) || newCost < 0) { alert('Please enter a valid invoice cost before updating the price.'); return; }
            const oldCost = parseFloat(item.cost || 0);
            const stamp = new Date().toISOString();
            if (!Array.isArray(item.priceHistory)) item.priceHistory = [];
            item.priceHistory.push({ date: stamp, oldCost, newCost });
            item.cost = newCost;
            item.priceLastUpdated = stamp;
            refreshPriceUpdatedDisplay(stamp);
            renderItemTable();
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            renderMenuTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
            showToast(`Price updated for ${item.name}. Recipes and menu costs have been refreshed.`, 'success');
        }

                document.getElementById('itemForm').addEventListener('submit', function(e) {
            e.preventDefault();

                        const id = document.getElementById('editItemId').value || 'ITEM-' + Date.now().toString();
            const enteredSku = plainText(document.getElementById('itemSku').value);

            // Block duplicate SKU (only check if a SKU was entered)
            if (enteredSku) {
                const skuConflict = itemDatabase.find(item =>
                    item.sku &&
                    item.sku.trim().toLowerCase() === enteredSku.toLowerCase() &&
                    item.id !== id
                );
                if (skuConflict) {
                    alert(`⚠️ SKU "${enteredSku}" is already assigned to "${skuConflict.name}". Please use a unique SKU or leave the field blank.`);
                    return;
                }
            }

            const existingItem = itemDatabase.find(item => item.id === id);
            const newCost = parseFloat(document.getElementById('invoiceCost').value);
            const oldCost = existingItem ? parseFloat(existingItem.cost || 0) : null;
            let priceLastUpdated = existingItem?.priceLastUpdated || new Date().toISOString();
            let priceHistory = Array.isArray(existingItem?.priceHistory) ? [...existingItem.priceHistory] : [];
            if (!existingItem || Math.abs((oldCost || 0) - newCost) > 0.0001 || !existingItem.priceLastUpdated) {
                priceLastUpdated = new Date().toISOString();
                priceHistory.push({ date: priceLastUpdated, oldCost, newCost });
            }

            const itemData = {
                id,
                name: plainText(document.getElementById('itemName').value),
                sku: plainText(document.getElementById('itemSku').value),
                supplier: document.getElementById('itemSupplier').value,
                category: document.getElementById('itemCategory').value,
                status: document.getElementById('itemStatus').value,
                cost: newCost,
                priceLastUpdated,
                priceHistory,
                packType: plainText(document.getElementById('packType').value),
                units: parseFloat(document.getElementById('unitsPerPack').value),
                unitSize: parseFloat(document.getElementById('unitSize').value),
                unitDescriptor: document.getElementById('unitDescriptor')?.value || 'Unit',
                unitMeasure: document.getElementById('unitMeasure').value,
                recipeMeasure: document.getElementById('recipeMeasure').value,
                            totalYield: parseFloat(document.getElementById('unitsPerPack').value) * parseFloat(document.getElementById('unitSize').value),
            yieldPct: parseFloat(document.getElementById('itemYield').value) || 100,
            excludeFromVariance: document.getElementById('itemExcludeFromVariance') ? document.getElementById('itemExcludeFromVariance').checked : false,
            customConversions: [...newItemCustomConversions]
            };

            const existingIndex = itemDatabase.findIndex(item => item.id === id);
            if (existingIndex > -1) itemDatabase[existingIndex] = itemData;
            else itemDatabase.push(itemData);

            syncItemNameInRecipes(id, itemData.name);

            newItemCustomConversions = [];
            cancelEdit();
            renderItemTable();
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            renderMenuTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        });

             function editItem(id) {
            const item = itemDatabase.find(i => i.id === id.toString());
            if (!item) return;
            openEditItemModal(item.id);
        }

        function populateEditModalDropdowns() {
            const catSel = document.getElementById('editModalItemCategory');
            if (catSel) {
                catSel.innerHTML = '';
                categoryDatabase.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat; opt.textContent = cat;
                    catSel.appendChild(opt);
                });
            }
            const supSel = document.getElementById('editModalItemSupplier');
            if (supSel) {
                supSel.innerHTML = '<option value="">Unassigned</option>';
                supplierDatabase.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s; opt.textContent = s;
                    supSel.appendChild(opt);
                });
            }
            const packSel = document.getElementById('editModalPackType');
            if (packSel) {
                packSel.innerHTML = '<option value="" disabled>Select Pack Type...</option>';
                packTypeDatabase.forEach(pt => {
                    const opt = document.createElement('option');
                    opt.value = pt; opt.textContent = pt;
                    packSel.appendChild(opt);
                });
            }
            const descSel = document.getElementById('editModalUnitDescriptor');
            if (descSel) {
                descSel.innerHTML = '';
                unitDescriptorDatabase.forEach(ud => {
                    const opt = document.createElement('option');
                    opt.value = ud; opt.textContent = ud;
                    descSel.appendChild(opt);
                });
            }
        }

        function updateEditModalPreview() {
            const previewEl = document.getElementById('editModalItemPreview');
            if (!previewEl) return;
            const name = plainText(document.getElementById('editModalItemName')?.value) || 'This item';
            const packType = document.getElementById('editModalPackType')?.value || '';
            const units = document.getElementById('editModalUnitsPerPack')?.value || '';
            const unitSize = document.getElementById('editModalUnitSize')?.value || '';
            const unitMeasure = document.getElementById('editModalUnitMeasure')?.value || '';
            const descriptor = document.getElementById('editModalUnitDescriptor')?.value || 'Unit';
            if (!packType || !units || !unitSize || !unitMeasure) {
                previewEl.textContent = 'Fill in Pack Type, Units per Pack, Size per Unit, and Unit Measure to see a live preview here.';
                return;
            }
            previewEl.textContent = `${name} ${/s$/i.test(name) ? 'are' : 'is'} received in a ${packType}. Units per pack is ${units} ${descriptor}${parseFloat(units) === 1 ? '' : 's'}, each ${descriptor} is ${unitSize} ${unitMeasure}.`;
        }

        function refreshEditModalPriceDisplay(value) {
            const display = document.getElementById('editModalPriceLastUpdatedDisplay');
            const hidden = document.getElementById('editModalItemPriceLastUpdated');
            if (hidden) hidden.value = value || '';
            if (display) display.textContent = formatPriceUpdatedDate(value);
        }

        function openEditItemModal(id) {
            const item = itemDatabase.find(i => i.id === id.toString());
            if (!item) return;

            populateEditModalDropdowns();

            document.getElementById('editItemModalId').value = item.id;
            document.getElementById('editModalItemName').value = item.name;
            document.getElementById('editModalItemSku').value = item.sku || '';
            document.getElementById('editModalItemSupplier').value = item.supplier || '';
            document.getElementById('editModalItemCategory').value = item.category;
            document.getElementById('editModalItemStatus').value = item.status || 'active';
            document.getElementById('editModalInvoiceCost').value = item.cost;
            refreshEditModalPriceDisplay(item.priceLastUpdated || '');

            document.getElementById('editModalPackType').value = item.packType;
            document.getElementById('editModalUnitsPerPack').value = item.units;
            document.getElementById('editModalUnitSize').value = item.unitSize;
            document.getElementById('editModalUnitDescriptor').value = item.unitDescriptor || 'Unit';
            document.getElementById('editModalUnitMeasure').value = item.unitMeasure;
            editModalCustomConversions = Array.isArray(item.customConversions) ? item.customConversions.map(c => ({ ...c })) : [];
            renderCustomConversionList(editModalCustomConversions, 'editModalCustomConversionList', true);
            populateRecipeOptions(item.unitMeasure, item.recipeMeasure, document.getElementById('editModalRecipeMeasure'), editModalCustomConversions);
            document.getElementById('editModalItemYield').value = item.yieldPct || 100;
            const excludeVarianceBox = document.getElementById('editModalItemExcludeFromVariance');
            if (excludeVarianceBox) excludeVarianceBox.checked = !!item.excludeFromVariance;
            updateEditModalPreview();

            const originalStatus = item.status || 'active';
            document.getElementById('editModalItemStatus').onchange = function() {
                if (this.value === 'inactive') {
                    const usedInPrep = prepDatabase.filter(p =>
                        p.ingredients && p.ingredients.some(ing => ing.itemId === item.id)
                    );
                    const usedInMenu = menuDatabase.filter(m =>
                        m.ingredients && m.ingredients.some(ing => ing.itemId === item.id)
                    );
                    if (usedInPrep.length > 0 || usedInMenu.length > 0) {
                        const prepNames = usedInPrep.map(p => `• ${p.name} (${p.property})`).join('\n');
                        const menuNames = usedInMenu.map(m => `• ${m.name} (${m.property})`).join('\n');
                        const allNames = [prepNames, menuNames].filter(Boolean).join('\n');
                        alert(`❌ Cannot set "${item.name}" to Inactive — it is currently used in the following recipes:\n\n${allNames}\n\nRemove this item from all recipes first, then set it to Inactive.`);
                        this.value = originalStatus;
                    }
                }
            };
            document.getElementById('editModalUnitMeasure').onchange = function() {
                populateRecipeOptions(this.value, null, document.getElementById('editModalRecipeMeasure'), editModalCustomConversions);
                updateEditModalPreview();
            };
            ['editModalItemName','editModalPackType','editModalUnitsPerPack','editModalUnitSize','editModalUnitDescriptor'].forEach(fid => {
                const el = document.getElementById(fid);
                if (el) { el.oninput = updateEditModalPreview; el.onchange = updateEditModalPreview; }
            });

            document.getElementById('editItemModal').style.display = 'block';
        }

        function cancelEditItemModal() {
            document.getElementById('editItemModal').style.display = 'none';
            document.getElementById('editItemModalId').value = '';
        }

        function updateItemPriceFromModal() {
            const id = document.getElementById('editItemModalId')?.value;
            if (!id) return;
            const item = itemDatabase.find(i => i.id === id);
            if (!item) return;
            const newCost = parseFloat(document.getElementById('editModalInvoiceCost')?.value || 0);
            if (!Number.isFinite(newCost) || newCost < 0) { alert('Please enter a valid invoice cost before updating the price.'); return; }
            const oldCost = parseFloat(item.cost || 0);
            const stamp = new Date().toISOString();
            if (!Array.isArray(item.priceHistory)) item.priceHistory = [];
            item.priceHistory.push({ date: stamp, oldCost, newCost });
            item.cost = newCost;
            item.priceLastUpdated = stamp;
            refreshEditModalPriceDisplay(stamp);
            renderItemTable();
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            renderMenuTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            renderVarianceTable();
            saveAllDataToBrowser(false);
            showToast(`Price updated for ${item.name}. Recipes and menu costs have been refreshed.`, 'success');
        }
		// --- BULK PRICE UPDATE FROM SUPC CSV ---
const PRICE_SWING_WARNING_PCT = 10;
let pendingPriceUpdates = [];
let pendingPriceUpdateSummary = null;

function normalizeSku(value) {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, '')
        .toUpperCase();
}

function stripLeadingZeros(value) {
    return normalizeSku(value).replace(/^0+/, '') || '0';
}

function parseMoney(value) {
    if (value === null || value === undefined) return null;
    const cleaned = String(value).replace(/[$,]/g, '').trim();
    if (cleaned === '') return null;
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
}

function formatMoney(value) {
    const num = parseFloat(value || 0);
    const sign = num < 0 ? '-' : '';
    return `${sign}$${Math.abs(num).toFixed(2)}`;
}

function formatPct(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return 'N/A';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
}

// Robust CSV parser that supports quoted commas and quoted line breaks.
function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (char === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }

        cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }

    return rows;
}

function extractPriceRowsFromSyscoCsv(csvText) {
    const rows = parseCsvRows(csvText);

    const headerRow = rows.find(row => String(row[0] || '').trim().toUpperCase() === 'F');

    if (!headerRow) {
        throw new Error('Could not find the CSV header row. Expected a row beginning with "F".');
    }

    const headers = headerRow.map(h => String(h || '').trim());

    const supcIndex = headers.findIndex(h => h.toUpperCase() === 'SUPC');
    const casePriceIndex = headers.findIndex(h => h.toUpperCase() === 'CASE $');
    const splitPriceIndex = headers.findIndex(h => h.toUpperCase() === 'SPLIT $');
    const descIndex = headers.findIndex(h => h.toUpperCase() === 'DESC');

    if (supcIndex === -1) {
        throw new Error('Could not find SUPC column in the CSV.');
    }

    if (casePriceIndex === -1) {
        throw new Error('Could not find Case $ column in the CSV.');
    }

    const productRows = rows.filter(row => String(row[0] || '').trim().toUpperCase() === 'P');

    return productRows
        .map(row => {
            const supc = normalizeSku(row[supcIndex]);
            const casePrice = parseMoney(row[casePriceIndex]);
            const splitPrice = splitPriceIndex > -1 ? parseMoney(row[splitPriceIndex]) : null;
            const desc = descIndex > -1 ? String(row[descIndex] || '').trim() : '';

            return {
                supc,
                casePrice,
                splitPrice,
                desc,
                raw: row
            };
        })
        .filter(row => row.supc && row.casePrice !== null);
}

function buildItemSkuLookup() {
    const exact = new Map();
    const stripped = new Map();

    itemDatabase.forEach(item => {
        const sku = normalizeSku(item.sku);
        if (!sku) return;

        if (!exact.has(sku)) exact.set(sku, []);
        exact.get(sku).push(item);

        const strippedSku = stripLeadingZeros(sku);
        if (!stripped.has(strippedSku)) stripped.set(strippedSku, []);
        stripped.get(strippedSku).push(item);
    });

    return { exact, stripped };
}

function findItemBySupc(supc, lookup) {
    const normalized = normalizeSku(supc);

    const exactMatches = lookup.exact.get(normalized) || [];

    if (exactMatches.length === 1) {
        return {
            item: exactMatches[0],
            matchType: 'Exact SUPC match'
        };
    }

    if (exactMatches.length > 1) {
        return {
            item: null,
            matchType: 'Duplicate SKU in Item Master',
            duplicateItems: exactMatches
        };
    }

    const strippedMatches = lookup.stripped.get(stripLeadingZeros(normalized)) || [];

    if (strippedMatches.length === 1) {
        return {
            item: strippedMatches[0],
            matchType: 'Matched after ignoring leading zeroes'
        };
    }

    if (strippedMatches.length > 1) {
        return {
            item: null,
            matchType: 'Duplicate SKU after ignoring leading zeroes',
            duplicateItems: strippedMatches
        };
    }

    return {
        item: null,
        matchType: 'No match'
    };
}

function importPriceUpdateCsv(file) {
    if (!file) {
        showToast('Please choose a CSV file first.', 'warning');
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const csvText = e.target.result;
            const csvRows = extractPriceRowsFromSyscoCsv(csvText);
            const lookup = buildItemSkuLookup();

            const seenSupc = new Set();
            const duplicateSupcs = new Set();

            csvRows.forEach(row => {
                if (seenSupc.has(row.supc)) duplicateSupcs.add(row.supc);
                seenSupc.add(row.supc);
            });

            pendingPriceUpdates = [];

            const unmatched = [];
            const duplicateItemMatches = [];
            const unchanged = [];

            csvRows.forEach(row => {
                const match = findItemBySupc(row.supc, lookup);

                if (!match.item) {
                    if (match.duplicateItems && match.duplicateItems.length > 1) {
                        duplicateItemMatches.push({
                            supc: row.supc,
                            desc: row.desc,
                            reason: match.matchType,
                            duplicateItems: match.duplicateItems.map(i => i.name)
                        });
                    } else {
                        unmatched.push(row);
                    }
                    return;
                }

                const item = match.item;
				const oldCost = parseFloat(item.cost || 0);
				const defaultPriceSource = 'case';
				const newCost = row.casePrice;
				
				if (!Number.isFinite(oldCost) || !Number.isFinite(newCost)) return;

                const changeAmount = newCost - oldCost;
                const changePct = oldCost > 0 ? (changeAmount / oldCost) * 100 : null;
                const isLargeSwing = changePct !== null && Math.abs(changePct) > PRICE_SWING_WARNING_PCT;

                if (Math.abs(changeAmount) < 0.0001) {
                    unchanged.push({
                        item,
                        supc: row.supc,
                        desc: row.desc,
                        oldCost,
                        newCost
                    });
                    return;
                }

                pendingPriceUpdates.push({
			    id: item.id,
			    itemName: item.name,
			    sku: item.sku || '',
			    supc: row.supc,
			    csvDescription: row.desc,
			    oldCost,
			    newCost,
			    originalCsvCost: newCost,
			    originalCaseCost: row.casePrice,
			    originalSplitCost: row.splitPrice,
			    selectedPriceSource: defaultPriceSource,
			    changeAmount,
			    changePct,
			    isLargeSwing,
			    matchType: match.matchType,
			    approved: true
			});
				
     		});
			
            pendingPriceUpdates.sort((a, b) => {
                if (a.isLargeSwing !== b.isLargeSwing) return a.isLargeSwing ? -1 : 1;
                return Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0);
            });

            pendingPriceUpdateSummary = {
                totalCsvRows: csvRows.length,
                matchedUpdates: pendingPriceUpdates.length,
                unmatchedCount: unmatched.length,
                duplicateItemMatchCount: duplicateItemMatches.length,
                unchangedCount: unchanged.length,
                duplicateSupcCount: duplicateSupcs.size,
                unmatched,
                duplicateItemMatches,
                unchanged
            };

            if (pendingPriceUpdates.length === 0) {
                showToast('CSV processed, but no price changes were found to review.', 'warning');
                console.log('Price update summary:', pendingPriceUpdateSummary);
                return;
            }

            renderPriceUpdateReviewModal();

        } catch (err) {
            console.error(err);
            alert(`Price update failed: ${err.message}`);
        }
    };

    reader.readAsText(file);
}

function ensurePriceUpdateReviewModal() {
    if (document.getElementById('priceUpdateReviewModal')) return;

    const modal = document.createElement('div');
    modal.id = 'priceUpdateReviewModal';
    modal.className = 'modal';

    modal.innerHTML = `
        <div class="modal-content" style="width: 92%; max-width: 1150px; margin: 4% auto;">
            <div class="modal-header">
                <h2>Review Price Updates</h2>
                <span class="close" onclick="closeModal('priceUpdateReviewModal')">&times;</span>
            </div>

            <div id="priceUpdateSummaryBox" style="margin-bottom:15px;"></div>

            <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; margin-bottom:10px; flex-wrap:wrap;">
                <label style="display:flex; align-items:center; gap:8px; font-weight:bold; cursor:pointer;">
                    <input type="checkbox" id="priceUpdateSelectAll" onchange="toggleAllPriceUpdates(this.checked)" style="width:auto;" checked>
                    Select / deselect all updates
                </label>

                <div style="display:flex; gap:10px;">
                    <button type="button" class="action-btn" onclick="downloadPriceUpdateReviewCsv()" style="background-color:#34495e;">
                        Download Review CSV
                    </button>

                    <button type="button" class="btn-submit" onclick="applySelectedPriceUpdates()" style="width:auto; padding:8px 16px;">
                        Apply Selected Updates
                    </button>
                </div>
            </div>

            <div style="max-height:55vh; overflow:auto; border:1px solid var(--border-color); border-radius:6px;">
                <table style="margin-bottom:0;">
                    <thead>
                        <tr>
                            <th>Apply</th>
                            <th>Flag</th>
                            <th>Item</th>
                            <th>SUPC</th>
                            <th>CSV Description</th>
                            <th>Old Price</th>
                            <th>New Price</th>
                            <th>Change</th>
                            <th>Match</th>
                        </tr>
                    </thead>
                    <tbody id="priceUpdateReviewBody"></tbody>
                </table>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

function renderPriceUpdateReviewModal() {
    ensurePriceUpdateReviewModal();

    const summary = pendingPriceUpdateSummary || {};
    const highSwingCount = pendingPriceUpdates.filter(u => u.isLargeSwing).length;

    const summaryBox = document.getElementById('priceUpdateSummaryBox');

    summaryBox.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:10px;">
            <div class="recipe-meta-card"><strong>CSV Rows Read</strong>${summary.totalCsvRows || 0}</div>
            <div class="recipe-meta-card"><strong>Price Changes</strong>${summary.matchedUpdates || 0}</div>
            <div class="recipe-meta-card"><strong>Over 10% Swing</strong><span style="color:${highSwingCount ? '#e74c3c' : '#18bc9c'}; font-weight:bold;">${highSwingCount}</span></div>
            <div class="recipe-meta-card"><strong>Unchanged</strong>${summary.unchangedCount || 0}</div>
            <div class="recipe-meta-card"><strong>No Match</strong>${summary.unmatchedCount || 0}</div>
            <div class="recipe-meta-card"><strong>Duplicate Match Issues</strong>${summary.duplicateItemMatchCount || 0}</div>
        </div>

        ${highSwingCount ? `<p style="color:#e74c3c; font-weight:bold; margin-bottom:0;">⚠️ Items over ${PRICE_SWING_WARNING_PCT}% are highlighted. Review them carefully, adjust the new price if needed, or uncheck them to ignore this time.</p>` : ''}
    `;

    const tbody = document.getElementById('priceUpdateReviewBody');

    tbody.innerHTML = pendingPriceUpdates.map((u, index) => {
        const rowColor = u.isLargeSwing ? '#fff3cd' : '#ffffff';
        const flagText = u.isLargeSwing ? '⚠️ >10%' : 'OK';
        const flagColor = u.isLargeSwing ? '#e74c3c' : '#18bc9c';
        const changeColor = u.changeAmount >= 0 ? '#e74c3c' : '#18bc9c';

        return `
            <tr style="background:${rowColor};">
                <td>
                    <input 
                        type="checkbox" 
                        class="price-update-cb" 
                        data-index="${index}" 
                        ${u.approved ? 'checked' : ''} 
                        style="width:auto;"
                        onchange="syncPriceUpdateApprovalsFromModal()"
                    >

                    <button 
                        type="button" 
                        class="mini-action-btn" 
                        onclick="ignorePendingPriceUpdate(${index})"
                        style="margin-left:6px;"
                    >
                        Ignore
                    </button>
                </td>

                <td style="font-weight:bold; color:${flagColor};">${flagText}</td>

                <td><strong>${escapeHtml(u.itemName)}</strong></td>

                <td>${escapeHtml(u.supc)}</td>

                <td>${escapeHtml(u.csvDescription || '')}</td>

                <td>${formatMoney(u.oldCost)}</td>

                <td>
				    <select 
				        onchange="updatePendingPriceSource(${index}, this.value)"
				        style="width:125px; padding:5px; margin-bottom:4px;"
				    >
				        <option value="case" ${u.selectedPriceSource === 'case' ? 'selected' : ''}>
				            Case $
				        </option>
				
				        <option 
				            value="split" 
				            ${u.selectedPriceSource === 'split' ? 'selected' : ''}
				            ${u.originalSplitCost === null || u.originalSplitCost === undefined ? 'disabled' : ''}
				        >
				            Broken Case $
				        </option>
				
				        <option value="manual" ${u.selectedPriceSource === 'manual' ? 'selected' : ''}>
				            Manual
				        </option>
				    </select>

    <input 
        type="number" 
        step="0.01" 
        min="0" 
        class="price-update-new-cost" 
        data-index="${index}" 
        value="${Number(u.newCost).toFixed(2)}" 
        onchange="updatePendingPriceNewCost(${index}, this.value)"
        style="width:95px; padding:5px;"
    >

    <div style="font-size:0.7rem; color:#7f8c8d; margin-top:3px;">
        Case: ${formatMoney(u.originalCaseCost)}
        ${u.originalSplitCost !== null && u.originalSplitCost !== undefined ? ` | Broken: ${formatMoney(u.originalSplitCost)}` : ' | Broken: N/A'}
    </div>
</td>

                <td style="font-weight:bold; color:${changeColor};">
                    ${formatMoney(u.changeAmount)} / ${formatPct(u.changePct)}
                </td>

                <td>${escapeHtml(u.matchType)}</td>
            </tr>
        `;
    }).join('');

    const selectAll = document.getElementById('priceUpdateSelectAll');
    if (selectAll) {
        selectAll.checked = pendingPriceUpdates.every(u => u.approved);
    }

    document.getElementById('priceUpdateReviewModal').style.display = 'block';
}


function updatePendingPriceSource(index, source) {
    const update = pendingPriceUpdates[index];
    if (!update) return;

    update.selectedPriceSource = source;

    if (source === 'case') {
        update.newCost = update.originalCaseCost;
    } else if (source === 'split') {
        if (update.originalSplitCost === null || update.originalSplitCost === undefined) {
            showToast('No broken case price is available for this item.', 'warning');
            update.selectedPriceSource = 'case';
            update.newCost = update.originalCaseCost;
        } else {
            update.newCost = update.originalSplitCost;
        }
    } else if (source === 'manual') {
        // Keep the current typed price.
    }

    update.changeAmount = update.newCost - update.oldCost;
    update.changePct = update.oldCost > 0 ? (update.changeAmount / update.oldCost) * 100 : null;
    update.isLargeSwing = update.changePct !== null && Math.abs(update.changePct) > PRICE_SWING_WARNING_PCT;

    renderPriceUpdateReviewModal();
}

function updatePendingPriceNewCost(index, value) {
    const update = pendingPriceUpdates[index];
    if (!update) return;

    const newCost = parseMoney(value);

    if (newCost === null || newCost < 0) {
        showToast('Please enter a valid price.', 'warning');
        renderPriceUpdateReviewModal();
        return;
    }

    update.newCost = newCost;
	update.selectedPriceSource = 'manual';
    update.changeAmount = update.newCost - update.oldCost;
    update.changePct = update.oldCost > 0 ? (update.changeAmount / update.oldCost) * 100 : null;
    update.isLargeSwing = update.changePct !== null && Math.abs(update.changePct) > PRICE_SWING_WARNING_PCT;

    renderPriceUpdateReviewModal();
}

function ignorePendingPriceUpdate(index) {
    const update = pendingPriceUpdates[index];
    if (!update) return;

    update.approved = false;

    const cb = document.querySelector(`.price-update-cb[data-index="${index}"]`);
    if (cb) cb.checked = false;

    const selectAll = document.getElementById('priceUpdateSelectAll');
    if (selectAll) selectAll.checked = pendingPriceUpdates.every(u => u.approved);
}

function toggleAllPriceUpdates(checked) {
    pendingPriceUpdates.forEach(u => {
        u.approved = checked;
    });

    document.querySelectorAll('.price-update-cb').forEach(cb => {
        cb.checked = checked;
    });
}

function syncPriceUpdateApprovalsFromModal() {
    document.querySelectorAll('.price-update-cb').forEach(cb => {
        const index = parseInt(cb.dataset.index, 10);

        if (pendingPriceUpdates[index]) {
            pendingPriceUpdates[index].approved = cb.checked;
        }
    });

    document.querySelectorAll('.price-update-new-cost').forEach(input => {
        const index = parseInt(input.dataset.index, 10);
        const update = pendingPriceUpdates[index];

        if (!update) return;

        const newCost = parseMoney(input.value);

        if (newCost === null || newCost < 0) return;

        update.newCost = newCost;

		const matchesCase = Math.abs((update.newCost || 0) - (update.originalCaseCost || 0)) < 0.0001;
		const matchesSplit = update.originalSplitCost !== null &&
		    update.originalSplitCost !== undefined &&
		    Math.abs((update.newCost || 0) - (update.originalSplitCost || 0)) < 0.0001;
		
		if (!matchesCase && !matchesSplit) {
		    update.selectedPriceSource = 'manual';
		}
		
		update.changeAmount = update.newCost - update.oldCost;
        update.changePct = update.oldCost > 0 ? (update.changeAmount / update.oldCost) * 100 : null;
        update.isLargeSwing = update.changePct !== null && Math.abs(update.changePct) > PRICE_SWING_WARNING_PCT;
    });

    const selectAll = document.getElementById('priceUpdateSelectAll');
    if (selectAll) {
        selectAll.checked = pendingPriceUpdates.every(u => u.approved);
    }
}

function applySelectedPriceUpdates() {
    syncPriceUpdateApprovalsFromModal();

    const selected = pendingPriceUpdates.filter(u => u.approved);

    if (selected.length === 0) {
        showToast('No price updates selected.', 'warning');
        return;
    }

    const flaggedSelected = selected.filter(u => u.isLargeSwing).length;

    let confirmMessage = `Apply ${selected.length} selected price update(s)?`;

    if (flaggedSelected > 0) {
        confirmMessage += `\n\nWarning: ${flaggedSelected} selected item(s) have more than a ${PRICE_SWING_WARNING_PCT}% price swing.`;
    }

    if (!confirm(confirmMessage)) return;

    const stamp = new Date().toISOString();
    let appliedCount = 0;

    selected.forEach(update => {
        const item = itemDatabase.find(i => i.id === update.id);
        if (!item) return;

        if (!Array.isArray(item.priceHistory)) item.priceHistory = [];

        item.priceHistory.push({
	    date: stamp,
	    oldCost: update.oldCost,
	    newCost: update.newCost,
	    source: 'CSV Price Update',
	    priceSource: update.selectedPriceSource || 'case',
	    supc: update.supc,
	    csvDescription: update.csvDescription,
	    originalCsvCost: update.originalCsvCost,
	    originalCaseCost: update.originalCaseCost,
	    originalSplitCost: update.originalSplitCost,
	    changePct: update.changePct
	});

        item.cost = update.newCost;
        item.priceLastUpdated = stamp;

        appliedCount++;
    });

    renderItemTable();
    renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
    renderMenuTable();
    renderPropertyMenus();
    renderSelectedPropertyMenuDetails();
    renderVarianceTable();
    saveAllDataToBrowser(false);

    closeModal('priceUpdateReviewModal');

    showToast(`${appliedCount} price update(s) applied successfully.`, 'success');

    pendingPriceUpdates = [];
    pendingPriceUpdateSummary = null;
}

function downloadPriceUpdateReviewCsv() {
    syncPriceUpdateApprovalsFromModal();

    const headers = [
	    'Apply',
	    'Flagged Over 10%',
	    'Price Source',
	    'Item Name',
	    'Item SKU',
	    'CSV SUPC',
	    'CSV Description',
	    'Old Price',
	    'New Price',
	    'Case Price',
	    'Broken Case Price',
	    'Change Amount',
	    'Change %',
	    'Match Type'
	];

    const rows = pendingPriceUpdates.map(u => [
	    u.approved ? 'Yes' : 'No',
	    u.isLargeSwing ? 'Yes' : 'No',
	    u.selectedPriceSource || 'case',
	    u.itemName,
	    u.sku,
	    u.supc,
	    u.csvDescription,
	    u.oldCost,
	    u.newCost,
	    u.originalCaseCost,
	    u.originalSplitCost ?? '',
	    u.changeAmount,
	    u.changePct === null ? '' : u.changePct.toFixed(4),
	    u.matchType
	]);

    const csv = [headers, ...rows]
        .map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const stamp = new Date().toISOString().slice(0, 10);

    a.href = url;
    a.download = `price-update-review-${stamp}.csv`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}
        function saveItemFromModal() {
            const id = document.getElementById('editItemModalId').value;
            if (!id) return;
            const enteredSku = plainText(document.getElementById('editModalItemSku').value);

            if (enteredSku) {
                const skuConflict = itemDatabase.find(item =>
                    item.sku &&
                    item.sku.trim().toLowerCase() === enteredSku.toLowerCase() &&
                    item.id !== id
                );
                if (skuConflict) {
                    alert(`⚠️ SKU "${enteredSku}" is already assigned to "${skuConflict.name}". Please use a unique SKU or leave the field blank.`);
                    return;
                }
            }

            const existingItem = itemDatabase.find(item => item.id === id);
            if (!existingItem) return;

            const newCost = parseFloat(document.getElementById('editModalInvoiceCost').value);
            const oldCost = parseFloat(existingItem.cost || 0);
            let priceLastUpdated = existingItem.priceLastUpdated || new Date().toISOString();
            let priceHistory = Array.isArray(existingItem.priceHistory) ? [...existingItem.priceHistory] : [];
            if (Math.abs((oldCost || 0) - newCost) > 0.0001 || !existingItem.priceLastUpdated) {
                priceLastUpdated = new Date().toISOString();
                priceHistory.push({ date: priceLastUpdated, oldCost, newCost });
            }

            const itemData = {
                ...existingItem,
                id,
                name: plainText(document.getElementById('editModalItemName').value),
                sku: enteredSku,
                supplier: document.getElementById('editModalItemSupplier').value,
                category: document.getElementById('editModalItemCategory').value,
                status: document.getElementById('editModalItemStatus').value,
                cost: newCost,
                priceLastUpdated,
                priceHistory,
                packType: plainText(document.getElementById('editModalPackType').value),
                units: parseFloat(document.getElementById('editModalUnitsPerPack').value),
                unitSize: parseFloat(document.getElementById('editModalUnitSize').value),
                unitDescriptor: document.getElementById('editModalUnitDescriptor')?.value || 'Unit',
                unitMeasure: document.getElementById('editModalUnitMeasure').value,
                recipeMeasure: document.getElementById('editModalRecipeMeasure').value,
                totalYield: parseFloat(document.getElementById('editModalUnitsPerPack').value) * parseFloat(document.getElementById('editModalUnitSize').value),
                yieldPct: parseFloat(document.getElementById('editModalItemYield').value) || 100,
                excludeFromVariance: document.getElementById('editModalItemExcludeFromVariance') ? document.getElementById('editModalItemExcludeFromVariance').checked : false,
                customConversions: [...editModalCustomConversions]
            };

            const existingIndex = itemDatabase.findIndex(item => item.id === id);
            if (existingIndex > -1) itemDatabase[existingIndex] = itemData;

            syncItemNameInRecipes(id, itemData.name);

            editModalCustomConversions = [];
            cancelEditItemModal();
            renderItemTable();
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            renderMenuTable();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            renderVarianceTable();
            saveAllDataToBrowser(false);
            showToast(`${itemData.name} updated successfully.`, 'success');
        }

                    function cancelEdit() {
            document.getElementById('itemForm').reset();
            document.getElementById('editItemId').value = "";
            document.getElementById('submitBtn').textContent = "Save New Item";
            document.getElementById('cancelBtn').style.display = "none";
            document.getElementById('itemStatusGroup').style.display = 'none';
            refreshPriceUpdatedDisplay('');
            const updatePriceBtn = document.getElementById('updatePriceBtn');
            if (updatePriceBtn) updatePriceBtn.style.display = 'none';
            recipeMeasureSelect.innerHTML = '<option value="" disabled selected>Select Received Measure first...</option>';
            newItemCustomConversions = [];
            renderCustomConversionList(newItemCustomConversions, 'customConversionList', false);
			document.getElementById('itemYield').value = 100;
            const excludeVarianceReset = document.getElementById('itemExcludeFromVariance');
            if (excludeVarianceReset) excludeVarianceReset.checked = false;
            const unitDescriptorReset = document.getElementById('unitDescriptor');
            if (unitDescriptorReset) unitDescriptorReset.value = 'Unit';
            updateItemFormPreview();

            const supplierSelect = document.getElementById('itemSupplier');
            if (supplierSelect) supplierSelect.value = '';

            const statusSelect = document.getElementById('itemStatus');
            if (statusSelect) {
                statusSelect.value = 'active';
                statusSelect.onchange = null;
            }
        }
		
		        function deleteItem(id) {
            const item = itemDatabase.find(i => i.id === id);
            if (!item) return;

            const usedInPrep = prepDatabase.filter(p =>
                p.ingredients && p.ingredients.some(ing => ing.itemId === id)
            );
            const usedInMenu = menuDatabase.filter(m =>
                m.ingredients && m.ingredients.some(ing => ing.itemId === id)
            );

            if (usedInPrep.length > 0 || usedInMenu.length > 0) {
                const prepNames = usedInPrep.map(p => `• ${p.name} (${p.property})`).join('\n');
                const menuNames = usedInMenu.map(m => `• ${m.name} (${m.property})`).join('\n');
                const allNames = [prepNames, menuNames].filter(Boolean).join('\n');
                alert(`❌ Cannot delete "${item.name}" — it is currently used in the following recipes:\n\n${allNames}\n\nRemove this item from all recipes before deleting.`);
                return;
            }

            if (!confirm(`Are you sure you want to permanently delete "${item.name}"? This cannot be undone.`)) return;

            itemDatabase = itemDatabase.filter(i => i.id !== id);
            renderItemTable();
            saveAllDataToBrowser(false);
        }

         function resetItemPagination() {
            itemCurrentPage = 1;
        }
        function changeItemPage(page) {
            itemCurrentPage = page;
            renderItemTable();
        }
        function renderItemPaginationControls(totalItems) {
            const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
            if (itemCurrentPage > totalPages) itemCurrentPage = totalPages;
            const startItem = totalItems === 0 ? 0 : ((itemCurrentPage - 1) * ITEMS_PER_PAGE) + 1;
            const endItem = Math.min(itemCurrentPage * ITEMS_PER_PAGE, totalItems);
            const buildControls = () => {
                if (totalItems <= ITEMS_PER_PAGE) {
                    return `<span style="font-size:0.85rem; color:#7f8c8d;">Showing ${totalItems} item${totalItems === 1 ? '' : 's'}</span>`;
                }
                let options = '';
                for (let i = 1; i <= totalPages; i++) {
                    options += `<option value="${i}" ${i === itemCurrentPage ? 'selected' : ''}>Page ${i}</option>`;
                }
                return `
                    <span style="font-size:0.85rem; color:#7f8c8d;">Showing ${startItem}-${endItem} of ${totalItems}</span>
                    <button type="button" class="action-btn" ${itemCurrentPage === 1 ? 'disabled' : ''} onclick="changeItemPage(${itemCurrentPage - 1})">Previous</button>
                    <select onchange="changeItemPage(parseInt(this.value, 10))" style="width:auto; padding:6px;">${options}</select>
                    <button type="button" class="action-btn" ${itemCurrentPage === totalPages ? 'disabled' : ''} onclick="changeItemPage(${itemCurrentPage + 1})">Next</button>
                `;
            };
            ['itemPaginationTop', 'itemPaginationBottom'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = buildControls();
            });
        }
        document.getElementById('searchInput')?.addEventListener('keyup', debounce(function() { resetItemPagination(); renderItemTable(); }, 200));
        document.getElementById('filterItemCategory')?.addEventListener('change', function() { resetItemPagination(); renderItemTable(); });
        document.getElementById('filterItemSupplier')?.addEventListener('change', function() { resetItemPagination(); renderItemTable(); });
        document.getElementById('filterItemStatus')?.addEventListener('change', function() { resetItemPagination(); renderItemTable(); });

        ['itemName','packType','unitsPerPack','unitSize','unitMeasure','unitDescriptor'].forEach(fieldId => {
            const el = document.getElementById(fieldId);
            if (el) el.addEventListener('input', updateItemFormPreview);
            if (el) el.addEventListener('change', updateItemFormPreview);
        });

        function updateItemSupplierFilterDropdown() {
            const sel = document.getElementById('filterItemSupplier');
            if (!sel) return;

            const current = sel.value;
            sel.innerHTML = '<option value="All">All Suppliers</option><option value="Unassigned">Unassigned</option>';

            supplierDatabase.forEach(supplier => {
                const opt = document.createElement('option');
                opt.value = supplier;
                opt.textContent = supplier;
                sel.appendChild(opt);
            });

            if (supplierDatabase.includes(current) || current === 'All' || current === 'Unassigned') {
                sel.value = current || 'All';
            }
        }

               function renderItemTable() {
            const tbody = document.getElementById('itemTableBody');
            if (!tbody) return;

            tbody.innerHTML = '';

            const filterText = (document.getElementById('searchInput')?.value || '').toLowerCase();
            const categoryFilter = document.getElementById('filterItemCategory')?.value || 'All';
            const supplierFilter = document.getElementById('filterItemSupplier')?.value || 'All';
            const statusFilter = document.getElementById('filterItemStatus')?.value || 'All';

            let filteredData = itemDatabase.filter(item => {
                const matchesText =
                    (item.name || '').toLowerCase().includes(filterText) ||
                    (item.sku || '').toLowerCase().includes(filterText) ||
                    (item.category || '').toLowerCase().includes(filterText) ||
                    (item.supplier || '').toLowerCase().includes(filterText);

                const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;

                const matchesSupplier =
                    supplierFilter === 'All' ||
                    (supplierFilter === 'Unassigned' ? !(item.supplier || '').trim() : item.supplier === supplierFilter);

                const matchesStatus =
                    statusFilter === 'All' || (item.status || 'active') === statusFilter;

                return matchesText && matchesCategory && matchesSupplier && matchesStatus;
            });

            filteredData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            renderItemPaginationControls(filteredData.length);
            if (filteredData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: #777;">No inventory items match your current search/filter.</td></tr>`;
                return;
            }

            const totalPages = Math.max(1, Math.ceil(filteredData.length / ITEMS_PER_PAGE));
            if (itemCurrentPage > totalPages) itemCurrentPage = totalPages;
            const startIndex = (itemCurrentPage - 1) * ITEMS_PER_PAGE;
            const pagedData = filteredData.slice(startIndex, startIndex + ITEMS_PER_PAGE);

            pagedData.forEach(item => {
                const costVal = calculateUnitCost(item);
                const costPerRecipeUnit = costVal !== null ? `$${costVal.toFixed(4)}` : "Pending Conv.";
                const supplierDisplay = item.supplier && item.supplier.trim() ? item.supplier : 'Unassigned';
                const skuDisplay = item.sku && item.sku.trim() ? item.sku : '—';
                const statusDisplay = item.status || 'active';

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong class="item-usage-link" onclick="openItemRecipeUsage('${item.id}')" title="Click to see every recipe and property where this item is used">${escapeHtml(item.name)}</strong>${item.excludeFromVariance ? ' <span style="font-size:0.7rem;color:#e74c3c;">(no variance)</span>' : ''}</td>
                    <td>${skuDisplay}</td>
                    <td>${supplierDisplay}</td>
                    <td>${item.category || '—'}</td>
                    <td>${statusDisplay}</td>
                    <td>${item.packType} (${item.units} x ${item.unitSize} ${item.unitMeasure})</td>
                    <td>${item.totalYield} ${item.unitMeasure} <span style="color:${(item.yieldPct||100)<100?'#e74c3c':'#888'}; font-size:0.8rem;">(${item.yieldPct||100}%)</span></td>
                    <td>${(item.recipeMeasure || '').replaceAll('_', ' ')}</td>
                    <td>$${item.cost.toFixed(2)}<br><span style="font-size:0.72rem; color:#7f8c8d;">${formatPriceUpdatedDate(item.priceLastUpdated).replace('Last price update: ', '')}</span></td>
                    <td style="color: #18bc9c; font-weight: bold;">${costPerRecipeUnit}</td>
                                        <td>
                        <button class="action-btn" onclick="editItem('${item.id}')">Edit</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteItem('${item.id}')">Delete</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }

        // --- PREP RECIPE SAVING LOGIC (Localized) ---
        document.getElementById('prepForm').addEventListener('submit', function(e) {
            e.preventDefault();
            if (currentPrepIngredients.length === 0) {
                alert("Please add at least one ingredient to the prep recipe."); return;
            }
            if(!currentProperty) {
                alert("Please create and select a property first."); return;
            }

            const id = document.getElementById('editPrepId').value || 'PREP-' + Date.now().toString();
            const name = document.getElementById('prepName').value;
            const yieldAmount = parseFloat(document.getElementById('prepYield').value);
            const yieldUnit = document.getElementById('prepUnit').value;
            const shelfLife = document.getElementById('prepShelfLife').value;
            const usage = document.getElementById('prepUsage').value;
            const usageUnit = document.getElementById('prepUsageUnit').value;
            const category = document.getElementById('prepCategory') ? document.getElementById('prepCategory').value : '';
            const includeInExport = document.getElementById('prepIncludeInExport') ? document.getElementById('prepIncludeInExport').checked : true;
            const steps = cleanRichText(document.getElementById('prepSteps').innerHTML);
            
            let portionWeight = null;
            let portionUnit = null;
            if (yieldUnit === 'Each') {
                portionWeight = parseFloat(document.getElementById('prepPortionWeight').value) || 0;
                portionUnit = document.getElementById('prepPortionUnit').value;
            }

            const totalCost = currentPrepIngredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
            const costPerUnit = totalCost / yieldAmount;

            const prepData = { 
                id, 
                property: currentProperty, 
                name, 
                category,
                includeInExport,
                yieldAmount, 
                yieldUnit, 
                shelfLife,
                usage,
                usageUnit,
                steps,
                portionWeight, 
                portionUnit, 
                totalCost, 
                costPerUnit, 
                ingredients: [...currentPrepIngredients] 
            };

            const existingIndex = prepDatabase.findIndex(p => p.id === id);
            if (existingIndex > -1) prepDatabase[existingIndex] = prepData;
            else prepDatabase.push(prepData);

            document.getElementById('prepForm').reset();
            document.getElementById('editPrepId').value = '';
            document.getElementById('prepSteps').innerHTML = ''; // Clear RTE
            currentPrepIngredients = [];
            updatePrepIngredientTable();
            renderPrepTable();
            renderPropertyTable();
            renderCloneLists();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
            togglePortionWeight();
            populatePrepUsageUnit();
            saveAllDataToBrowser(false);
        });

        document.getElementById('searchPrepInput').addEventListener('keyup', debounce(function() { renderPrepTable(this.value.toLowerCase()); }, 200));

        function renderPrepTable(filterText = null) {
            const tbody = document.getElementById('prepTableBody');
            tbody.innerHTML = '';
            
            const searchText = filterText !== null ? filterText : (document.getElementById('searchPrepInput')?.value || '').toLowerCase();
            const sortOrder = document.getElementById('sortPrepCost')?.value || 'alpha';
            const categoryFilter = document.getElementById('filterPrepCategory')?.value || 'All';
            const filteredData = prepDatabase.filter(p => p.property === currentProperty && (p.name || '').toLowerCase().includes(searchText) && (categoryFilter === 'All' || (p.category || '') === categoryFilter));
            if (sortOrder === 'high-low') {
                filteredData.sort((a, b) => calculatePrepCostPerUnit(b) - calculatePrepCostPerUnit(a) || (a.name || '').localeCompare(b.name || ''));
            } else if (sortOrder === 'low-high') {
                filteredData.sort((a, b) => calculatePrepCostPerUnit(a) - calculatePrepCostPerUnit(b) || (a.name || '').localeCompare(b.name || ''));
            } else {
                filteredData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            }
            
            if(filteredData.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #777;">No prep recipes saved for ${currentProperty || "this property"} yet.</td></tr>`; return; }

            filteredData.forEach(prep => {
                const shelfLifeDisplay = prep.shelfLife ? `${prep.shelfLife} Days` : 'N/A';
                const usageUnitLabel = unitDisplayMap[prep.usageUnit] || prep.usageUnit || '—';
                const row = document.createElement('tr');
                row.className = 'recipe-row-clickable';
                row.onclick = function(e) {
                    if (e.target.closest('button')) return;
                    viewPrepRecipe(prep.id);
                };
                row.innerHTML = `
                    <td><strong>${prep.name}</strong> <span style="font-size:0.75rem; color:#7f8c8d;">(click to view)</span>${prep.category ? ` <span style=\"font-size:0.72rem;color:#18bc9c;font-weight:bold;\">[${escapeHtml(prep.category)}]</span>` : ''}${prep.includeInExport === false ? ' <span style=\"font-size:0.7rem;color:#e74c3c;\">(excluded from export)</span>' : ''}</td>
                    <td>${prep.yieldAmount} ${prep.yieldUnit}</td>
                    <td>${shelfLifeDisplay}</td>
                    <td style="color: #18bc9c; font-weight: bold;">$${calculatePrepCostPerUnit(prep).toFixed(4)} / ${prep.yieldUnit === 'Each' ? 'Portion' : prep.yieldUnit}</td>
                    <td>
                        <button class="action-btn" onclick="printSinglePrepRecipe('${prep.id}')">🖨 Print</button>
                        <button class="action-btn" onclick="editPrep('${prep.id}')">Edit</button>
                        <button class="action-btn" style="background-color:var(--info)" onclick="openSingleDuplicateModal('${prep.id}', 'prep')">Copy</button>
                        <button class="action-btn" style="background-color:var(--cancel)" onclick="deletePrep('${prep.id}')">Delete</button>
                    </td>`;
                tbody.appendChild(row);
            });
        }

        function editPrep(id) {
            const prep = prepDatabase.find(p => p.id === id);
            if(!prep) return;
            document.getElementById('editPrepId').value = prep.id;
            document.getElementById('prepName').value = prep.name;
            if (document.getElementById('prepCategory')) document.getElementById('prepCategory').value = prep.category || '';
            if (document.getElementById('prepIncludeInExport')) document.getElementById('prepIncludeInExport').checked = prep.includeInExport !== false;
            document.getElementById('prepYield').value = prep.yieldAmount;
            document.getElementById('prepUnit').value = prep.yieldUnit;
            document.getElementById('prepShelfLife').value = prep.shelfLife || '';
            document.getElementById('prepUsage').value = prep.usage || '';
            document.getElementById('prepSteps').innerHTML = prep.steps || '';
            togglePortionWeight();
            populatePrepUsageUnit(prep.usageUnit);
            if(prep.yieldUnit === 'Each') {
            document.getElementById('prepPortionWeight').value = prep.portionWeight;
            document.getElementById('prepPortionUnit').value = prep.portionUnit;
            }
            currentPrepIngredients = [...prep.ingredients];
            updatePrepIngredientTable();
            window.scrollTo({ top: 0, behavior: 'smooth' });
			document.getElementById('prepCancelBtn').style.display = 'block';
 }
		function cancelPrepEdit() {
		    document.getElementById('prepForm').reset();
		    document.getElementById('editPrepId').value = '';
		    document.getElementById('prepSteps').innerHTML = '';
		    currentPrepIngredients = [];
		    updatePrepIngredientTable();
		    document.getElementById('prepCancelBtn').style.display = 'none';
		    togglePortionWeight();
		    populatePrepUsageUnit();
}
        function deletePrep(id) {
            const prep = prepDatabase.find(p => p.id === id);
            if (!prep) return;

            const linkedMenuItems = [];
            menuDatabase.forEach(m => {
                if (m.ingredients && m.ingredients.some(ing => ing.itemId === id)) {
                    linkedMenuItems.push(`• ${m.name} (${m.property})`);
                }
            });

            if (linkedMenuItems.length > 0) {
                alert(`❌ Cannot delete "${prep.name}" — it is currently used as an ingredient in the following menu item recipes:\n\n${linkedMenuItems.join('\n')}\n\nRemove it from those recipes first, then delete.`);
                return;
            }

            if (!confirm(`Are you sure you want to permanently delete the prep recipe "${prep.name}"? This cannot be undone.`)) return;

            prepDatabase = prepDatabase.filter(p => p.id !== id);
            renderPrepTable(document.getElementById('searchPrepInput')?.value?.toLowerCase() || '');
            renderPropertyTable();
            renderCloneLists();
            saveAllDataToBrowser(false);
        }

        // --- MENU ITEM SAVING LOGIC (Localized) ---
        function updateMenuCategoryFilterOptions() {
            const select = document.getElementById('filterMenuCategory');
            const currentVal = select.value;
            select.innerHTML = '<option value="All">All Categories</option>';
                        const categories = menuItemCategoryDatabase;
            categories.sort().forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat; opt.textContent = cat;
                select.appendChild(opt);
            });
            if (categories.includes(currentVal)) select.value = currentVal;
        }

        document.getElementById('menuForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            if (currentMenuIngredients.length === 0) {
                alert("Please add at least one ingredient to the menu item."); return;
            }
            if(!currentProperty) {
                alert("Please create and select a property first."); return;
            }

            const id = document.getElementById('editMenuId').value || 'MENU-' + Date.now().toString();
            const name = document.getElementById('menuItemName').value;
            const category = document.getElementById('menuCategory').value;
            const targetPrice = parseFloat(document.getElementById('menuPrice').value);

            const foodCost = currentMenuIngredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
            const costPercentage = targetPrice > 0 ? (foodCost / targetPrice) * 100 : 0;

                   const steps = cleanRichText(document.getElementById('menuSteps').innerHTML);
        const tipsNotes = cleanRichText(document.getElementById('menuTipsNotes').innerHTML);
        const cookTime = document.getElementById('cookTime').value;
const menuData = { id, property: currentProperty, name, category, targetPrice, foodCost, costPercentage, steps, tipsNotes, cookTime, ingredients: [...currentMenuIngredients] };

            const existingIndex = menuDatabase.findIndex(m => m.id === id);
            if (existingIndex > -1) menuDatabase[existingIndex] = menuData;
            else menuDatabase.push(menuData);

            document.getElementById('menuForm').reset();
            document.getElementById('editMenuId').value = '';
            document.getElementById('menuSteps').innerHTML = '';
            document.getElementById('menuTipsNotes').innerHTML = '';
            document.getElementById('menuCancelBtn').style.display = 'none';
            currentMenuIngredients = [];
            updateMenuIngredientTable();
            updateMenuCategoryFilterOptions();
            renderMenuTable();
            renderPropertyTable();
            renderCloneLists();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        });

        document.getElementById('searchMenuInput').addEventListener('keyup', debounce(renderMenuTable, 200));

        function renderMenuTable() {
            const tbody = document.getElementById('menuTableBody');
            tbody.innerHTML = '';
            
            const filterText = document.getElementById('searchMenuInput').value.toLowerCase();
            const categoryFilter = document.getElementById('filterMenuCategory').value;
            const sortOrder = document.getElementById('sortMenuCost').value;

            let filteredData = menuDatabase.filter(m => m.property === currentProperty);

            if (filterText) {
                filteredData = filteredData.filter(m => m.name.toLowerCase().includes(filterText) || m.category.toLowerCase().includes(filterText));
            }
            if (categoryFilter && categoryFilter !== 'All') {
                filteredData = filteredData.filter(m => m.category === categoryFilter);
            }

            if (sortOrder === 'high-low') {
                filteredData.sort((a, b) => calculateMenuCostPercentage(b) - calculateMenuCostPercentage(a) || (a.name || '').localeCompare(b.name || ''));
            } else if (sortOrder === 'low-high') {
                filteredData.sort((a, b) => calculateMenuCostPercentage(a) - calculateMenuCostPercentage(b) || (a.name || '').localeCompare(b.name || ''));
            } else {
                filteredData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            }
            
            if(filteredData.length === 0) { tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #777;">No menu items match your criteria.</td></tr>`; return; }

            filteredData.forEach(menu => {
            const liveFoodCost = calculateMenuFoodCostExcludingCredits(menu);
			const liveCostPercentage = calculateMenuCostPercentageExcludingCredits(menu);

                let costColor = liveCostPercentage > 35 ? '#e74c3c' : (liveCostPercentage >= 30 ? '#f39c12' : '#18bc9c');
                
                const row = document.createElement('tr');
                row.className = 'recipe-row-clickable';
                row.onclick = function(e) {
                    if (e.target.closest('button')) return;
                    viewMenuRecipe(menu.id);
                };
                row.innerHTML = `
                    <td><strong>${menu.name}</strong> <span style="font-size:0.75rem; color:#7f8c8d;">(click to view)</span></td>
                    <td>${menu.category}</td>
                    <td>$${liveFoodCost.toFixed(2)}</td>
                    <td>$${menu.targetPrice.toFixed(2)}</td>
                    <td style="color: ${costColor}; font-weight: bold;">${liveCostPercentage.toFixed(1)}%</td>
                                       <td>
                        <button class="action-btn" onclick="editMenu('${menu.id}')">Edit</button>
                        <button class="action-btn" style="background-color: var(--info);" onclick="openSingleDuplicateModal('${menu.id}', 'menu')">Copy</button>
                        <button class="action-btn" style="background-color: #27ae60;" onclick="exportSingleMenuItemPptx('${menu.id}')">🖨 PPTX</button>
                        <button class="action-btn" style="background-color: var(--cancel);" onclick="deleteMenuItem('${menu.id}')">Delete</button>
                    </td>`;
                tbody.appendChild(row);
            });
        }

        function ensureEditMenuItemModal() {
            if (document.getElementById('editMenuItemModal')) return;
            const modal = document.createElement('div');
            modal.id = 'editMenuItemModal';
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content" style="width: 86%; max-width: 1050px; margin: 3% auto;">
                    <div class="modal-header">
                        <h2>Edit Menu Item Recipe</h2>
                        <span class="close" onclick="cancelEditMenuModal()">&times;</span>
                    </div>
                    <input type="hidden" id="editMenuModalId" value="">
                    <div style="display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                        <div class="form-group">
                            <label>Menu Item Name</label>
                            <input type="text" id="editMenuModalName" required>
                        </div>
                        <div class="form-group">
                            <label>Menu Category</label>
                            <select id="editMenuModalCategory" required></select>
                        </div>
                        <div class="form-group">
                            <label>Target Selling Price ($)</label>
                            <input type="number" step="0.01" id="editMenuModalPrice" required>
                        </div>
                        <div class="form-group">
                            <label>Cook Time</label>
                            <input type="text" id="editMenuModalCookTime" placeholder="e.g. 12 mins">
                        </div>
                    </div>
                    <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 20px 0;">
                    <h3>Build Steps & Ingredients</h3>
                    <table>
                        <thead><tr><th>Item / Prep Recipe</th><th>Qty</th><th>Unit</th><th>Cost</th><th>Action</th></tr></thead>
                        <tbody id="editMenuModalIngredientsBody">
                            <tr><td colspan="5" style="text-align:center;color:#777;">No ingredients added yet.</td></tr>
                        </tbody>
                    </table>
                    <div class="btn-group" style="margin-bottom: 25px;">
                        <button type="button" class="btn-submit" onclick="openIngredientModal('editMenuModal')" style="width:auto; background-color:#34495e;">+ Add Ingredient</button>
                    </div>
                    <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 20px 0;">
                    <div style="display:grid; grid-template-columns:2fr 1fr; gap:20px;">
                        <div>
                            <h3 style="margin-top:0;">Steps of Preparation</h3>
                            <div class="rte-container">
                                <div class="rte-toolbar">
                                    <button type="button" onclick="rteCmd('bold','editMenuModalSteps')"><b>B</b></button>
                                    <button type="button" onclick="rteCmd('italic','editMenuModalSteps')"><i>I</i></button>
                                    <button type="button" onclick="rteCmd('underline','editMenuModalSteps')"><u>U</u></button>
                                    <span style="width:1px; background:#ccc; align-self:stretch; margin:0 2px;"></span>
                                    <button type="button" onclick="rteCmd('insertUnorderedList','editMenuModalSteps')">&#8226; Bullet</button>
                                    <button type="button" onclick="rteCmd('insertOrderedList','editMenuModalSteps')">1. Number</button>
                                    <span style="width:1px; background:#ccc; align-self:stretch; margin:0 2px;"></span>
                                    <button type="button" onclick="rteCmd('indent','editMenuModalSteps')" title="Indent (Tab)">&#8677; Indent</button>
                                    <button type="button" onclick="rteCmd('outdent','editMenuModalSteps')" title="Outdent (Shift+Tab)">&#8676; Outdent</button>
                                </div>
                                <div id="editMenuModalSteps" class="rte-editor" contenteditable="true" placeholder="Enter preparation steps here..."></div>
                            </div>
                        </div>
                        <div>
                            <h3 style="margin-top:0;">Tips / Notes</h3>
                            <div class="rte-container">
                                <div class="rte-toolbar">
                                    <button type="button" onclick="rteCmd('bold','editMenuModalTipsNotes')"><b>B</b></button>
                                    <button type="button" onclick="rteCmd('italic','editMenuModalTipsNotes')"><i>I</i></button>
                                    <button type="button" onclick="rteCmd('underline','editMenuModalTipsNotes')"><u>U</u></button>
                                    <span style="width:1px; background:#ccc; align-self:stretch; margin:0 2px;"></span>
                                    <button type="button" onclick="rteCmd('insertUnorderedList','editMenuModalTipsNotes')">&#8226; Bullet</button>
                                    <button type="button" onclick="rteCmd('insertOrderedList','editMenuModalTipsNotes')">1. Number</button>
                                </div>
                                <div id="editMenuModalTipsNotes" class="rte-editor" contenteditable="true" placeholder="Enter tips, notes, or allergen information here..."></div>
                            </div>
                        </div>
                    </div>
                    <div class="btn-group" style="margin-top: 15px;">
                        <button type="button" class="btn-submit" onclick="saveMenuFromModal()">Save Changes</button>
                        <button type="button" class="btn-cancel" style="display:block;" onclick="cancelEditMenuModal()">Cancel</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        function populateEditMenuModalCategoryDropdown(selectedCategory = '') {
            ensureEditMenuItemModal();
            const sel = document.getElementById('editMenuModalCategory');
            if (!sel) return;
            sel.innerHTML = '<option value="" disabled>Select Category...</option>';
            [...menuItemCategoryDatabase].sort((a, b) => a.localeCompare(b)).forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                sel.appendChild(opt);
            });
            if (selectedCategory && !menuItemCategoryDatabase.includes(selectedCategory)) {
                const opt = document.createElement('option');
                opt.value = selectedCategory;
                opt.textContent = selectedCategory;
                sel.appendChild(opt);
            }
            sel.value = selectedCategory || '';
        }

        function updateEditMenuModalIngredientTable() {
            const tbody = document.getElementById('editMenuModalIngredientsBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (currentEditMenuModalIngredients.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#777;">No ingredients added yet.</td></tr>`;
                return;
            }
            let totalCost = 0;
            currentEditMenuModalIngredients.forEach((ing, index) => {
                const lineCost = getLiveIngredientTotalCost(ing);
                const isCredit = parseFloat(ing.qty) < 0;
                if (!isCredit) totalCost += lineCost;
                tbody.innerHTML += `<tr${isCredit ? ' style="background-color:#fdecea;"' : ''}><td><strong>${escapeHtml(ing.name)}</strong>${isCredit ? ' <span style="font-size:0.72rem;color:#e74c3c;font-weight:bold;">(credit)</span>' : ''}</td><td>${ing.qty}</td><td>${escapeHtml(ing.unit)}</td><td style="${isCredit ? 'color:#e74c3c;font-weight:bold;' : ''}">${formatCurrency(lineCost)}</td>
                <td>
                    <button type="button" class="action-btn" style="background-color: var(--warning);" onclick="editIngredientQuantity('editMenuModal', ${index})">Edit</button>
                    <button type="button" class="action-btn" style="background-color: var(--cancel);" onclick="removeIngredient('editMenuModal', ${index})">X</button>
                </td></tr>`;
            });
            tbody.innerHTML += `<tr style="background-color:#e9ecef;"><td colspan="3" style="text-align:right;font-weight:bold;">Total Plate Cost:</td><td colspan="2" style="font-weight:bold;color:var(--primary);">${formatCurrency(totalCost)}</td></tr>`;
        }

        function editMenu(id) {
            const menu = menuDatabase.find(m => m.id === id);
            if (!menu) return;
            ensureEditMenuItemModal();
            populateEditMenuModalCategoryDropdown(menu.category || '');
            document.getElementById('editMenuModalId').value = menu.id;
            document.getElementById('editMenuModalName').value = menu.name || '';
            document.getElementById('editMenuModalPrice').value = menu.targetPrice || 0;
            document.getElementById('editMenuModalCookTime').value = menu.cookTime || '';
            currentEditMenuModalIngredients = Array.isArray(menu.ingredients) ? menu.ingredients.map(ing => ({ ...ing })) : [];
            updateEditMenuModalIngredientTable();
            document.getElementById('editMenuModalSteps').innerHTML = menu.steps || '';
            document.getElementById('editMenuModalTipsNotes').innerHTML = menu.tipsNotes || '';
            document.getElementById('editMenuItemModal').style.display = 'block';
        }

        function cancelEditMenuModal() {
            const modal = document.getElementById('editMenuItemModal');
            if (modal) modal.style.display = 'none';
            currentEditMenuModalIngredients = [];
        }

        function saveMenuFromModal() {
            const id = document.getElementById('editMenuModalId')?.value || '';
            if (!id) return;
            if (currentEditMenuModalIngredients.length === 0) {
                alert('Please add at least one ingredient to the menu item.');
                return;
            }
            const existingIndex = menuDatabase.findIndex(m => m.id === id);
            const existing = existingIndex > -1 ? menuDatabase[existingIndex] : null;
            if (!existing) return;
            const name = plainText(document.getElementById('editMenuModalName').value);
            const category = document.getElementById('editMenuModalCategory').value;
            const targetPrice = parseFloat(document.getElementById('editMenuModalPrice').value);
            if (!name) { alert('Please enter a menu item name.'); return; }
            if (!category) { alert('Please select a menu category.'); return; }
            if (!Number.isFinite(targetPrice) || targetPrice < 0) { alert('Please enter a valid target selling price.'); return; }
            const ingredients = currentEditMenuModalIngredients.map(ing => ({ ...ing }));
            const foodCost = ingredients.reduce((sum, ing) => sum + getLiveIngredientTotalCost(ing), 0);
            const costPercentage = targetPrice > 0 ? (foodCost / targetPrice) * 100 : 0;
            const menuData = {
                ...existing,
                id,
                property: existing.property || currentProperty,
                name,
                category,
                targetPrice,
                foodCost,
                costPercentage,
                steps: cleanRichText(document.getElementById('editMenuModalSteps').innerHTML),
                tipsNotes: cleanRichText(document.getElementById('editMenuModalTipsNotes').innerHTML),
                cookTime: plainText(document.getElementById('editMenuModalCookTime').value),
                ingredients
            };
            menuDatabase[existingIndex] = menuData;
            cancelEditMenuModal();
            updateMenuCategoryFilterOptions();
            renderMenuTable();
            renderPropertyTable();
            renderCloneLists();
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            renderVarianceTable();
            saveAllDataToBrowser(false);
            showToast(`${menuData.name} updated successfully.`, 'success');
        }

        function deleteMenuItem(id) {
		    const menu = menuDatabase.find(m => m.id === id);
		    if (!menu) return;
		    const linkedMenus = [];
		    propertyMenuDatabase.forEach(pm => pm.categories.forEach(cat => cat.items.forEach(line => {
		        if (line.recipeId === id) linkedMenus.push(`${pm.name} > ${cat.name} (${pm.property})`);
		    })));
		    if (linkedMenus.length > 0) {
		        alert(`Cannot delete "${menu.name}" — it is currently listed in the following menus:\n${linkedMenus.join('\n')}\n\nRemove it from those menus first, then delete.`);
		        return;
    }
		    if (!confirm(`Are you sure you want to permanently delete the recipe "${menu.name}"? This cannot be undone.`)) return;
		    menuDatabase = menuDatabase.filter(m => m.id !== id);
		    updateMenuCategoryFilterOptions();
		    renderMenuTable();
		    renderPropertyTable();
		    renderPropertyMenus();
		    renderSelectedPropertyMenuDetails();
		    saveAllDataToBrowser(false);
}

        // --- MODAL LOGIC (Adding Ingredients) ---
        function openIngredientModal(target) {
            activeModalTarget = target; 
            document.getElementById('ingredientModal').style.display = 'block';
            document.getElementById('modalSearch').value = ''; 
            renderModalTable(); 
        }

		function closeModal(modalId) {
		    const modal = document.getElementById(modalId);
		    if (modal) modal.style.display = 'none';
}        
        window.onclick = function(event) { 
            if (event.target == document.getElementById('ingredientModal')) closeModal('ingredientModal'); 
            if (event.target == document.getElementById('duplicateModal')) closeModal('duplicateModal'); 
            if (event.target == document.getElementById('editMenuItemModal')) cancelEditMenuModal(); 
        }
        
        document.getElementById('modalSearch').addEventListener('keyup', debounce(function() { renderModalTable(this.value.toLowerCase()); }, 200));

        function renderModalTable(filterText = "") {
            const tbody = document.getElementById('modalTableBody');
            tbody.innerHTML = '';
            
            let combinedData = [];

            itemDatabase.filter(item => item.name.toLowerCase().includes(filterText)).forEach(item => {
                combinedData.push({ id: item.id, name: item.name, packBreakdown: `${item.packType || 'Pack'} (${item.units || 0} x ${item.unitSize || 0} ${item.unitMeasure || ''})`, category: item.category, unit: (item.recipeMeasure || '').replace('_', ' '), cost: calculateUnitCost(item), type: 'raw' });
            });

            prepDatabase.filter(prep => prep.property === currentProperty && prep.name.toLowerCase().includes(filterText)).forEach(prep => {
                combinedData.push({ id: prep.id, name: prep.name, packBreakdown: `${prep.yieldAmount || ''} ${prep.yieldUnit || ''} yield`, category: 'Prep Recipe', unit: prep.yieldUnit === 'Each' ? 'Portion' : prep.yieldUnit, cost: calculatePrepCostPerUnit(prep), type: 'prep' });
            });
			    combinedData.sort((a, b) => a.name.localeCompare(b.name)); 

                if(combinedData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No items or local prep recipes found. Add them first.</td></tr>`;
                return;
            }
			      
                        combinedData.forEach(data => {
                let costDisplay = data.cost !== null ? `$${data.cost.toFixed(4)}` : "Pending Conv.";
                let badgeColor = data.type === 'prep' ? '#2980b9' : '#7f8c8d';

                // Build compatible unit options for raw items
                let unitSelectHtml = '';
                if (data.type === 'raw') {
                    const item = itemDatabase.find(i => i.id === data.id);
                    const volUnits = ['L','ML','FL_OZ','Cups','Tbsp','Tsp'];
                    const weightUnits = ['KG','G','LBS','OZ'];
                    const volLabels = { L:'Liters (L)', ML:'Milliliters (ML)', FL_OZ:'Fluid oz', Cups:'Cups', Tbsp:'Tbsp', Tsp:'Tsp' };
                    const weightLabels = { KG:'Kilograms (KG)', G:'Grams (G)', LBS:'Pounds (lbs)', OZ:'Ounces (oz)' };
                    let compatibleUnits = [];
                    if (volUnits.includes(item.unitMeasure)) compatibleUnits = volUnits.map(u => ({ val: u, label: volLabels[u] }));
                    else if (weightUnits.includes(item.unitMeasure)) compatibleUnits = weightUnits.map(u => ({ val: u, label: weightLabels[u] }));
                    else compatibleUnits = [{ val: 'Each', label: 'Each' }];
                    // Append any item-specific custom conversion units (e.g. Cups for a KG-received flour)
                    if (Array.isArray(item.customConversions)) {
                        item.customConversions.forEach(c => {
                            [c.fromUnit, c.toUnit].forEach(u => {
                                if (u !== item.unitMeasure && !compatibleUnits.some(cu => cu.val === u)) {
                                    compatibleUnits.push({ val: u, label: `${getCustomConversionUnitLabel(u)} (Custom)` });
                                }
                            });
                        });
                    }
                                        unitSelectHtml = `<select id="unit-${data.id}" style="width:120px; padding:4px; font-size:0.85rem;" onchange="updateModalCost('${data.id}')">
                        ${compatibleUnits.map(u => `<option value="${u.val}" ${u.val === item.recipeMeasure ? 'selected' : ''}>${u.label}</option>`).join('')}
                    </select>`;
                } else {
                    // Prep recipe - build unit dropdown based on yieldUnit
                    const prep = prepDatabase.find(p => p.id === data.id);
                    const volUnits = ['L','ML','FL_OZ','Cups','Tbsp','Tsp'];
                    const weightUnits = ['KG','G','LBS','OZ'];
                    const volLabels = { L:'Liters (L)', ML:'Milliliters (ML)', FL_OZ:'Fluid oz', Cups:'Cups', Tbsp:'Tbsp', Tsp:'Tsp' };
                    const weightLabels = { KG:'Kilograms (KG)', G:'Grams (G)', LBS:'Pounds (lbs)', OZ:'Ounces (oz)' };
                    let prepUnits = [];
                    if (volUnits.includes(prep.yieldUnit)) prepUnits = volUnits.map(u => ({ val: u, label: volLabels[u] }));
                    else if (weightUnits.includes(prep.yieldUnit)) prepUnits = weightUnits.map(u => ({ val: u, label: weightLabels[u] }));
                    else prepUnits = [{ val: 'Portion', label: 'Portion' }];
                    const defaultPrepUnit = prep.usageUnit && prepUnits.some(u => u.val === prep.usageUnit) ? prep.usageUnit : prepUnits[0]?.val;
                    unitSelectHtml = `<select id="unit-${data.id}" style="width:120px; padding:4px; font-size:0.85rem;" onchange="updateModalCost('${data.id}', 'prep')">
                        ${prepUnits.map(u => `<option value="${u.val}" ${u.val === defaultPrepUnit ? 'selected' : ''}>${u.label}</option>`).join('')}
                                        </select>`;
                    // Recalculate initial cost display for the default unit
                    const volToML2 = { L:1000, ML:1, FL_OZ:29.5735, Cups:250, Tbsp:15, Tsp:5 };
                    const weightToG2 = { KG:1000, G:1, LBS:453.592, OZ:28.3495 };
                    let initCost = data.cost;
                    if (defaultPrepUnit && volToML2[prep.yieldUnit] && volToML2[defaultPrepUnit]) {
                        initCost = data.cost * (volToML2[defaultPrepUnit] / volToML2[prep.yieldUnit]);
                    } else if (defaultPrepUnit && weightToG2[prep.yieldUnit] && weightToG2[defaultPrepUnit]) {
                        initCost = data.cost * (weightToG2[defaultPrepUnit] / weightToG2[prep.yieldUnit]);
                    }
                    costDisplay = `$${initCost.toFixed(4)}`;
                }

                                const activeIngredients = activeModalTarget === 'prep' ? currentPrepIngredients : (activeModalTarget === 'editMenuModal' ? currentEditMenuModalIngredients : currentMenuIngredients);
                                const alreadyAdded = activeIngredients.some(ing => ing.itemId === data.id || ing.id === data.id);
                const checkmark = alreadyAdded ? ' <span style="color: #18bc9c; font-weight:bold;" title="Already in this recipe">✔</span>' : '';

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td><strong>${data.name}</strong>${checkmark}</td>
                    <td>${data.packBreakdown || '—'}</td>
                    <td><span style="background-color:${badgeColor}; color:white; padding:3px 6px; border-radius:4px; font-size:0.8rem;">${data.category}</span></td>
                    <td>${unitSelectHtml}</td>
                    <td id="cost-${data.id}" style="color: #18bc9c; font-weight:bold;">${costDisplay}</td>
                       <td>
					    <div class="add-qty-container">
                            <input type="number" step="0.01" id="qty-${data.id}" class="add-qty-input" placeholder="Qty (use - to credit)">
                            <button class="add-btn" onclick="addIngredientToRecipe('${data.id}', '${data.type}', this)">Add</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
		
			function updateModalCost(itemId, type = 'raw') {
            const unit = document.getElementById(`unit-${itemId}`)?.value;
            const costCell = document.getElementById(`cost-${itemId}`);
            if (!costCell) return;
            let cost = 0;
            if (type === 'prep') {
                const prep = prepDatabase.find(p => p.id === itemId);
                if (!prep) return;
                cost = convertCostPerUnit(calculatePrepCostPerUnit(prep), prep.yieldUnit, unit === 'Portion' ? prep.yieldUnit : unit);
            } else cost = getRawItemUnitCostForRecipeUnit(itemId, unit);
            costCell.textContent = `$${cost.toFixed(4)}`;
        }

        function addIngredientToRecipe(id, type, btnElement) {
            const qtyInput = document.getElementById(`qty-${id}`);
            const qty = parseFloat(qtyInput.value);

            if (!qty || qty === 0 || Number.isNaN(qty)) { alert("Please enter a non-zero quantity. Use a negative number to credit/remove this ingredient (e.g., for a substitution)."); return; }

            let name, unit, costVal;

                       if (type === 'raw') {
                const item = itemDatabase.find(i => i.id === id);
                const selectedUnit = document.getElementById(`unit-${id}`)?.value || item.recipeMeasure;
                let baseCost = calculateUnitCost(item);
                if (baseCost === null) { alert("This item requires a Master Conversion before use."); return; }
                // Recalculate cost for the chosen unit relative to the item's default recipe unit
                // (routes through getUnitRatio with the item so custom weight<->volume conversions apply)
                costVal = convertCostPerUnit(baseCost, item.recipeMeasure, selectedUnit, item);
                name = item.name; unit = selectedUnit;
            } else {
                const prep = prepDatabase.find(p => p.id === id);
                const basePrepCost = calculatePrepCostPerUnit(prep);
                const selectedUnit = document.getElementById(`unit-${id}`)?.value || (prep.yieldUnit === 'Each' ? 'Portion' : prep.yieldUnit);
                const volToML = { L:1000, ML:1, FL_OZ:29.5735, Cups:250, Tbsp:15, Tsp:5 };
                const weightToG = { KG:1000, G:1, LBS:453.592, OZ:28.3495 };
                costVal = basePrepCost;
                if (volToML[prep.yieldUnit] && volToML[selectedUnit]) {
                costVal = basePrepCost * (volToML[selectedUnit] / volToML[prep.yieldUnit]);
                } else if (weightToG[prep.yieldUnit] && weightToG[selectedUnit]) {
                    costVal = basePrepCost * (weightToG[selectedUnit] / weightToG[prep.yieldUnit]);
                }
                name = prep.name; unit = selectedUnit;
            }

            const ingredientEntry = { itemId: id, name: name, qty: qty, unit: unit, totalCost: qty * costVal, type: type };

            if (activeModalTarget === 'prep') {
                currentPrepIngredients.push(ingredientEntry); updatePrepIngredientTable();
            } else if (activeModalTarget === 'menu') {
                currentMenuIngredients.push(ingredientEntry); updateMenuIngredientTable();
            } else if (activeModalTarget === 'editMenuModal') {
                currentEditMenuModalIngredients.push(ingredientEntry); updateEditMenuModalIngredientTable();
            }

            qtyInput.value = ''; 
            
            if (btnElement) {
                const originalText = btnElement.textContent;
                btnElement.textContent = "Added!";
                btnElement.style.backgroundColor = "#27ae60";
                setTimeout(() => {
                    btnElement.textContent = originalText;
                    btnElement.style.backgroundColor = "var(--secondary)";
                }, 1000);
            }
        }

        // --- Edit Ingredient Amounts ---
        let editIngredientModalTarget = null;
        let editIngredientModalIndex = null;

        function buildEditIngredientUnitOptions(ing) {
            const volUnits = ['L','ML','FL_OZ','Cups','Tbsp','Tsp'];
            const weightUnits = ['KG','G','LBS','OZ'];
            const volLabels = { L:'Liters (L)', ML:'Milliliters (ML)', FL_OZ:'Fluid oz', Cups:'Cups', Tbsp:'Tbsp', Tsp:'Tsp' };
            const weightLabels = { KG:'Kilograms (KG)', G:'Grams (G)', LBS:'Pounds (lbs)', OZ:'Ounces (oz)' };
            let options = [];

            if (ing.type === 'raw') {
                const item = itemDatabase.find(i => i.id === ing.itemId);
                if (!item) return [{ val: ing.unit, label: ing.unit }];
                if (volUnits.includes(item.unitMeasure)) options = volUnits.map(u => ({ val: u, label: volLabels[u] }));
                else if (weightUnits.includes(item.unitMeasure)) options = weightUnits.map(u => ({ val: u, label: weightLabels[u] }));
                else options = [{ val: 'Each', label: 'Each' }];
                if (Array.isArray(item.customConversions)) {
                    item.customConversions.forEach(c => {
                        [c.fromUnit, c.toUnit].forEach(u => {
                            if (u !== item.unitMeasure && !options.some(o => o.val === u)) {
                                options.push({ val: u, label: `${getCustomConversionUnitLabel(u)} (Custom)` });
                            }
                        });
                    });
                }
            } else if (ing.type === 'prep') {
                const prep = prepDatabase.find(p => p.id === ing.itemId);
                if (!prep) return [{ val: ing.unit, label: ing.unit }];
                if (volUnits.includes(prep.yieldUnit)) options = volUnits.map(u => ({ val: u, label: volLabels[u] }));
                else if (weightUnits.includes(prep.yieldUnit)) options = weightUnits.map(u => ({ val: u, label: weightLabels[u] }));
                else options = [{ val: 'Portion', label: 'Portion' }];
            } else {
                options = [{ val: ing.unit, label: ing.unit }];
            }

            if (!options.some(o => o.val === ing.unit)) options.push({ val: ing.unit, label: ing.unit });
            return options;
        }

        function editIngredientQuantity(target, index) {
            const arr = target === 'prep' ? currentPrepIngredients : (target === 'editMenuModal' ? currentEditMenuModalIngredients : currentMenuIngredients);
            const ing = arr[index];
            if (!ing) return;

            editIngredientModalTarget = target;
            editIngredientModalIndex = index;

            document.getElementById('editIngredientModalName').textContent = ing.name;
            document.getElementById('editIngredientModalQty').value = ing.qty;

            const unitSel = document.getElementById('editIngredientModalUnit');
            const options = buildEditIngredientUnitOptions(ing);
            unitSel.innerHTML = options.map(o => `<option value="${o.val}" ${o.val === ing.unit ? 'selected' : ''}>${o.label}</option>`).join('');

            document.getElementById('editIngredientModal').style.display = 'block';
        }

        function cancelEditIngredientModal() {
            document.getElementById('editIngredientModal').style.display = 'none';
            editIngredientModalTarget = null;
            editIngredientModalIndex = null;
        }

        function saveEditIngredientModal() {
            if (editIngredientModalTarget === null || editIngredientModalIndex === null) return;
            const arr = editIngredientModalTarget === 'prep' ? currentPrepIngredients : (editIngredientModalTarget === 'editMenuModal' ? currentEditMenuModalIngredients : currentMenuIngredients);
            const ing = arr[editIngredientModalIndex];
            if (!ing) return;

            const newQty = parseFloat(document.getElementById('editIngredientModalQty').value);
            const newUnit = document.getElementById('editIngredientModalUnit').value;

            if (Number.isNaN(newQty) || newQty === 0) {
                alert('Please enter a valid, non-zero quantity.');
                return;
            }

            ing.qty = newQty;
            ing.unit = newUnit;
            ing.totalCost = getLiveIngredientTotalCost(ing);

            if (editIngredientModalTarget === 'prep') updatePrepIngredientTable();
            else if (editIngredientModalTarget === 'editMenuModal') updateEditMenuModalIngredientTable();
            else updateMenuIngredientTable();

            cancelEditIngredientModal();
        }

        function formatCurrency(value) {
            const v = parseFloat(value) || 0;
            return `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`;
        }

        function updatePrepIngredientTable() {
            const tbody = document.getElementById('prepIngredientsBody');
            tbody.innerHTML = '';
            if(currentPrepIngredients.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #777;">No ingredients added yet.</td></tr>`; return; }

            let totalCost = 0;
            currentPrepIngredients.forEach((ing, index) => {
                const lineCost = getLiveIngredientTotalCost(ing);
                totalCost += lineCost;
                const isCredit = parseFloat(ing.qty) < 0;
                tbody.innerHTML += `<tr${isCredit ? ' style="background-color:#fdecea;"' : ''}><td><strong>${ing.name}</strong>${isCredit ? ' <span style="font-size:0.72rem;color:#e74c3c;font-weight:bold;">(credit)</span>' : ''}</td><td>${ing.qty}</td><td>${ing.unit}</td><td style="${isCredit ? 'color:#e74c3c;font-weight:bold;' : ''}">${formatCurrency(lineCost)}</td>
                <td>
                    <button type="button" class="action-btn" style="background-color: var(--warning);" onclick="editIngredientQuantity('prep', ${index})">Edit</button>
                    <button type="button" class="action-btn" style="background-color: var(--cancel);" onclick="removeIngredient('prep', ${index})">X</button>
                </td></tr>`;
            });
            tbody.innerHTML += `<tr style="background-color: #e9ecef;"><td colspan="3" style="text-align: right; font-weight: bold;">Total Batch Cost:</td><td colspan="2" style="font-weight: bold; color: var(--primary);">${formatCurrency(totalCost)}</td></tr>`;
        }

        function updateMenuIngredientTable() {
            const tbody = document.getElementById('menuIngredientsBody');
            tbody.innerHTML = '';
            if(currentMenuIngredients.length === 0) { tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #777;">No ingredients added yet.</td></tr>`; return; }

            let totalCost = 0;
            currentMenuIngredients.forEach((ing, index) => {
                const lineCost = getLiveIngredientTotalCost(ing);
                const isCredit = parseFloat(ing.qty) < 0;
                if (!isCredit) totalCost += lineCost;
                tbody.innerHTML += `<tr${isCredit ? ' style="background-color:#fdecea;"' : ''}><td><strong>${ing.name}</strong>${isCredit ? ' <span style="font-size:0.72rem;color:#e74c3c;font-weight:bold;">(credit)</span>' : ''}</td><td>${ing.qty}</td><td>${ing.unit}</td><td style="${isCredit ? 'color:#e74c3c;font-weight:bold;' : ''}">${formatCurrency(lineCost)}</td>
                <td>
                    <button type="button" class="action-btn" style="background-color: var(--warning);" onclick="editIngredientQuantity('menu', ${index})">Edit</button>
                    <button type="button" class="action-btn" style="background-color: var(--cancel);" onclick="removeIngredient('menu', ${index})">X</button>
                </td></tr>`;
            });
            tbody.innerHTML += `<tr style="background-color: #e9ecef;"><td colspan="3" style="text-align: right; font-weight: bold;">Total Plate Cost:</td><td colspan="2" style="font-weight: bold; color: var(--primary);">${formatCurrency(totalCost)}</td></tr>`;
        }

        function removeIngredient(target, index) {
            if (target === 'prep') { currentPrepIngredients.splice(index, 1); updatePrepIngredientTable(); }
            else if (target === 'editMenuModal') { currentEditMenuModalIngredients.splice(index, 1); updateEditMenuModalIngredientTable(); }
            else { currentMenuIngredients.splice(index, 1); updateMenuIngredientTable(); }
        }

        // --- SINGLE RECIPE DUPLICATION LOGIC ---
        function openSingleDuplicateModal(id, type) {
            if (propertyDatabase.length < 2) { alert("You need at least two properties to duplicate a recipe."); return; }
            
            duplicateTargetId = id;
            duplicateTargetType = type;
            
            const selector = document.getElementById('duplicateTargetSelector');
            for(let i = 0; i < selector.options.length; i++) {
                if(selector.options[i].value !== currentProperty) {
                    selector.selectedIndex = i;
                    break;
                }
            }
            document.getElementById('duplicateModal').style.display = 'block';
        }

        function executeSingleDuplicate() {
            const targetProperty = document.getElementById('duplicateTargetSelector').value;
            if (targetProperty === currentProperty) { alert("You are already in " + currentProperty + ". Select a different property."); return; }

            const rnd = () => Math.random().toString(36).substr(2, 5);

            if (duplicateTargetType === 'prep') {
                const original = prepDatabase.find(p => p.id === duplicateTargetId);
                const clone = JSON.parse(JSON.stringify(original)); 
                clone.id = 'PREP-' + Date.now().toString() + '-' + rnd(); 
                clone.property = targetProperty; 
                prepDatabase.push(clone);
            } else {
                const original = menuDatabase.find(m => m.id === duplicateTargetId);
                const clone = JSON.parse(JSON.stringify(original)); 
                clone.id = 'MENU-' + Date.now().toString() + '-' + rnd();
                clone.property = targetProperty;
                menuDatabase.push(clone);
            }

            closeModal('duplicateModal');
            alert(`Recipe successfully copied to ${targetProperty}!`);
            renderPropertyTable();
            renderCloneLists();
            saveAllDataToBrowser(false);
            renderPropertyMenus();
            renderSelectedPropertyMenuDetails();
            saveAllDataToBrowser(false);
        }

        // ── UNIT DISPLAY MAP ──────────────────────────────────────
        const unitDisplayMap = {
            FL_OZ: 'fl oz', ML: 'ml', CUP: 'cup', TSP: 'tsp', TBSP: 'tbsp',
            OZ: 'oz', KG: 'kg', LB: 'lb', LBS: 'lbs', G: 'gram', Each: 'Each'
        };

        function getPrepUnitFamily(yieldUnit) {
            if (['L', 'ML', 'FL_OZ', 'CUP', 'Cups', 'TSP', 'Tsp', 'TBSP', 'Tbsp'].includes(yieldUnit)) return 'volume';
            if (['KG', 'G', 'LB', 'LBS', 'OZ'].includes(yieldUnit)) return 'weight';
            return 'each';
        }

        function populatePrepUsageUnit(preselect) {
            const yieldUnit = document.getElementById('prepUnit').value;
            const family = getPrepUnitFamily(yieldUnit);
            const sel = document.getElementById('prepUsageUnit');

            let options = [];
            if (family === 'volume') {
                options = [
                    { v: 'FL_OZ', l: 'fl oz (default)' },
                    { v: 'ML',    l: 'ml' },
                    { v: 'CUP',   l: 'cup' },
                    { v: 'TSP',   l: 'tsp' },
                    { v: 'TBSP',  l: 'tbsp' }
                ];
            } else if (family === 'weight') {
                options = [
                    { v: 'OZ',  l: 'oz (default)' },
                    { v: 'KG',  l: 'kg' },
                    { v: 'LB',  l: 'lb' },
                    { v: 'G',   l: 'gram' }
                ];
            } else {
                options = [{ v: 'Each', l: 'Each' }];
            }

            sel.innerHTML = options.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
            if (preselect && options.find(o => o.v === preselect)) {
                sel.value = preselect;
            }
        }

        // ── RICH TEXT EDITOR HELPERS ───────────────────────────────
        function rteCmd(command, targetId) {
            const el = document.getElementById(targetId || 'prepSteps');
            if (el) el.focus();
            document.execCommand(command, false, null);
        }

        document.getElementById('prepSteps').addEventListener('keydown', function(e) {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;

            // Are we inside a list item?
            let node = sel.anchorNode;
            let inList = false;
            while (node && node !== this) {
                if (node.nodeName === 'LI') { inList = true; break; }
                node = node.parentNode;
            }

            if (inList) {
                // Tab indents, Shift+Tab outdents
                document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);

                // After indent inside an OL, the sub-list browser creates is usually
                // another OL. We want it to be a UL (bullet). Swap it.
                if (!e.shiftKey) {
                    setTimeout(() => {
                        const li = (() => {
                            let n = window.getSelection().anchorNode;
                            while (n && n !== this) {
                                if (n.nodeName === 'LI') return n;
                                n = n.parentNode;
                            }
                            return null;
                        })();
                        if (li) {
                            const parent = li.parentElement;
                            if (parent && parent.nodeName === 'OL') {
                                // Check depth: if parent's parent is also a list item
                                // it means we are nested → convert to UL
                                const grandParent = parent.parentElement;
                                if (grandParent && grandParent.nodeName === 'LI') {
                                    const ul = document.createElement('ul');
                                    ul.style.cssText = parent.style.cssText;
                                    while (parent.firstChild) ul.appendChild(parent.firstChild);
                                    parent.replaceWith(ul);
                                    // Restore cursor into the li
                                    const range = document.createRange();
                                    range.selectNodeContents(ul.querySelector('li') || ul);
                                    range.collapse(false);
                                    const s = window.getSelection();
                                    s.removeAllRanges();
                                    s.addRange(range);
                                }
                            }
                        }
                    }, 0);
                }
            } else {
                // Outside a list – insert 4 non-breaking spaces as indent
                document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
            }
        });

        // ── VIEW PREP RECIPE POPUP ─────────────────────────────────
        function viewPrepRecipe(id) {
            const prep = prepDatabase.find(p => p.id === id);
            if (!prep) return;

            const usageUnitLabel = unitDisplayMap[prep.usageUnit] || prep.usageUnit || '—';
            const ingRows = (prep.ingredients || []).map(ing =>
                `<tr>
                    <td>${ing.name}</td>
                    <td>${ing.qty}</td>
                    <td>${ing.unit}</td>
                    <td>$${getLiveIngredientTotalCost(ing).toFixed(2)}</td>
                </tr>`
            ).join('') || '<tr><td colspan="4" style="color:#777; text-align:center;">No ingredients listed.</td></tr>';

            document.getElementById('viewRecipeTitle').textContent = prep.name;
            document.getElementById('viewRecipeBody').innerHTML = `
                <div class="recipe-meta-grid">
                    <div class="recipe-meta-card"><strong>Yield</strong>${prep.yieldAmount} ${prep.yieldUnit}</div>
                    <div class="recipe-meta-card"><strong>Shelf Life</strong>${prep.shelfLife ? prep.shelfLife + ' Days' : 'N/A'}</div>
                    <div class="recipe-meta-card"><strong>Recipe Use Unit</strong>${usageUnitLabel}</div>
                    <div class="recipe-meta-card"><strong>Usage / Application</strong>${prep.usage || '—'}</div>
                    <div class="recipe-meta-card"><strong>Food Cost (batch)</strong>$${calculatePrepTotalCost(prep).toFixed(2)}</div>
                    <div class="recipe-meta-card"><strong>Cost per ${prep.yieldUnit === 'Each' ? 'Portion' : prep.yieldUnit}</strong>$${calculatePrepCostPerUnit(prep).toFixed(4)}</div>
                </div>
                <h4 style="margin: 0 0 8px 0;">Ingredients</h4>
                <table style="margin-bottom: 20px;">
                    <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead>
                    <tbody>${ingRows}</tbody>
                </table>
                <h4 style="margin: 0 0 8px 0;">Preparation Steps</h4>
                <div class="recipe-steps-preview">${prep.steps || '<em style="color:#aaa;">No steps entered.</em>'}</div>
            `;
            document.getElementById('viewRecipeModal').style.display = 'block';
        }

// ── VIEW MENU RECIPE POPUP ─────────────────────────────────
        function viewMenuRecipe(id) {
            const menu = menuDatabase.find(m => m.id === id);
            if (!menu) return;

            const ingRows = (menu.ingredients || []).map(ing =>
                `<tr>
                    <td>${ing.name}</td>
                    <td>${ing.qty}</td>
                    <td>${ing.unit}</td>
                    <td>$${getLiveIngredientTotalCost(ing).toFixed(2)}</td>
                </tr>`
            ).join('') || '<tr><td colspan="4" style="color:#777; text-align:center;">No ingredients listed.</td></tr>';

            const liveFoodCost = calculateMenuFoodCost(menu);
            const liveCostPercentage = calculateMenuCostPercentage(menu);
            let costColor = liveCostPercentage > 35 ? '#e74c3c' : (liveCostPercentage >= 30 ? '#f39c12' : '#18bc9c');

            document.getElementById('viewRecipeTitle').textContent = menu.name;
            document.getElementById('viewRecipeBody').innerHTML = `
                <div style="display:flex; justify-content:flex-end; margin-bottom:12px;">
                    <button type="button" class="action-btn" style="background-color:var(--info); padding:6px 12px;" onclick="exportSingleMenuItemCogsPdf('${menu.id}')">Export COGS % PDF</button>
                </div>
                <div class="recipe-meta-grid">
                    <div class="recipe-meta-card"><strong>Category</strong>${menu.category || '—'}</div>
                    <div class="recipe-meta-card"><strong>Target Price</strong>$${menu.targetPrice.toFixed(2)}</div>
                    <div class="recipe-meta-card"><strong>Food Cost</strong>$${liveFoodCost.toFixed(2)}</div>
                    <div class="recipe-meta-card"><strong>Cost %</strong><span style="color: ${costColor}; font-weight: bold;">${liveCostPercentage.toFixed(1)}%</span></div>
                    <div class="recipe-meta-card"><strong>Cook Time</strong>${menu.cookTime || '—'}</div>
                </div>
                <h4 style="margin: 0 0 8px 0;">Ingredients</h4>
                <table style="margin-bottom: 20px;">
                    <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead>
                    <tbody>${ingRows}</tbody>
                </table>
                <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px;">
                    <div>
                        <h4 style="margin: 0 0 8px 0;">Preparation Steps</h4>
                        <div class="recipe-steps-preview">${menu.steps || '<em style="color:#aaa;">No steps entered.</em>'}</div>
                    </div>
                    <div>
                        <h4 style="margin: 0 0 8px 0;">Tips / Notes</h4>
                        <div class="recipe-steps-preview">${menu.tipsNotes || '<em style="color:#aaa;">No tips entered.</em>'}</div>
                    </div>
                </div>
            `;
            document.getElementById('viewRecipeModal').style.display = 'block';
        }

        window.addEventListener('click', function(e) {
            if (e.target === document.getElementById('viewRecipeModal')) {
                closeModal('viewRecipeModal');
            }
        });

        
        document.addEventListener('input', function(e) {
            if (e.target.matches('input, select, textarea, [contenteditable="true"]')) markDirty();
        });
        document.addEventListener('change', function(e) {
            if (e.target.matches('input, select, textarea')) markDirty();
        });
// --- Init App ---
               (function initApp() {
            const loaded = loadAllDataFromBrowser();

            if (!loaded) {
                initSettings();
                updateUIPropertyNames();
                updateItemCategoryDropdown();
                updateSupplierDropdown();
                updateItemCategoryFilterDropdown();
                updateItemSupplierFilterDropdown();
                updateItemCategoryFilterDropdown();
                renderItemTable();
                renderPrepTable();
                updateMenuCategoryFilterOptions();
                renderMenuTable();
                renderPropertyMenus();
                renderSelectedPropertyMenuDetails();
            }

            populatePrepUsageUnit();
            populateCustomConversionUnitDropdowns('customConvFromUnit', 'customConvToUnit');
            populateCustomConversionUnitDropdowns('editModalCustomConvFromUnit', 'editModalCustomConvToUnit');
            renderCustomConversionList(newItemCustomConversions, 'customConversionList', false);
        })();



// ─── MENU ITEM COGS % PDF EXPORT ─────────────────────────────────────────────
// Opens a print-ready PDF page. In the print dialog, choose "Save as PDF".
function getCogsCostColor(costPct) {
    return costPct > 35 ? '#e74c3c' : (costPct >= 30 ? '#f39c12' : '#18bc9c');
}
function getCogsPdfStyles() {
    return `@page { size: letter portrait; margin: 0.45in; }
        * { box-sizing: border-box; }
        body { font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; color:#111; background:#fff; margin:0; }
        .cogs-page { page-break-after: always; padding:0; }
        .cogs-page:last-child { page-break-after:auto; }
        .cogs-title-row { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:28px; }
        h1 { font-size:1.55rem; line-height:1.15; margin:0; font-weight:800; }
        .property-line { color:#666; font-size:0.82rem; margin-top:5px; }
        .meta-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:12px; }
        .meta-card { background:#f8f9fa; border:1px solid #dee2e6; border-radius:6px; padding:12px; min-height:66px; font-size:0.9rem; }
        .meta-card strong { display:block; font-size:0.75rem; text-transform:uppercase; color:#2c3e50; margin-bottom:6px; letter-spacing:0.02em; }
        .meta-card .value { font-weight:600; }
        h2 { font-size:1rem; margin:22px 0 8px 0; }
        table { width:100%; border-collapse:collapse; font-size:0.92rem; }
        th { background:#e9ecef; color:#000; padding:10px 12px; text-align:left; font-weight:800; border-bottom:1px solid #d7dde2; }
        td { padding:11px 12px; border-bottom:1px solid #dee2e6; vertical-align:top; }
        .num { white-space:nowrap; }
        .muted { color:#888; font-style:italic; }
        @media print { .no-print { display:none !important; } body { margin:0; } }`;
}
function buildMenuItemCogsPdfHTML(menu) {
    const liveFoodCost = calculateMenuFoodCostExcludingCredits(menu);
    const liveCostPercentage = calculateMenuCostPercentageExcludingCredits(menu);
    const costColor = getCogsCostColor(liveCostPercentage);
    const targetPrice = parseFloat(menu.targetPrice || 0);
    const ingredientRows = getNonCreditIngredients(menu).map(ing => `<tr><td>${escapeHtml(ing.name || '')}</td><td class="num">${escapeHtml(ing.qty ?? '')}</td><td>${escapeHtml(ing.unit || '')}</td><td class="num">$${getLiveIngredientTotalCost(ing).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;">No ingredients listed.</td></tr>';
    return `<section class="cogs-page"><div class="cogs-title-row"><div><h1>${escapeHtml(menu.name || 'Menu Item')}</h1><div class="property-line">${escapeHtml(currentProperty || '')}</div></div></div>
        <div class="meta-grid"><div class="meta-card"><strong>Category</strong><span class="value">${escapeHtml(menu.category || '—')}</span></div><div class="meta-card"><strong>Target Price</strong><span class="value">$${targetPrice.toFixed(2)}</span></div><div class="meta-card"><strong>Food Cost</strong><span class="value">$${liveFoodCost.toFixed(2)}</span></div><div class="meta-card"><strong>Cost %</strong><span class="value" style="color:${costColor}; font-weight:800;">${liveCostPercentage.toFixed(1)}%</span></div><div class="meta-card"><strong>Cook Time</strong><span class="value">${escapeHtml(menu.cookTime || '—')}</span></div></div>
        <h2>Ingredients</h2><table><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Cost</th></tr></thead><tbody>${ingredientRows}</tbody></table></section>`;
}
function generateMenuItemsCogsPdf(items, title = 'Menu Item COGS % Export') {
    if (!items || items.length === 0) return showToast('No menu items to export.', 'warning');
    const pages = items.map(buildMenuItemCogsPdfHTML).join('');
    const w = window.open('', '_blank');
    if (!w) return showToast('Pop-up blocked. Please allow pop-ups to export the COGS % PDF.', 'warning');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>${getCogsPdfStyles()}</style></head><body><div class="no-print" style="padding:12px 0.45in; border-bottom:1px solid #dee2e6; display:flex; justify-content:space-between; align-items:center; gap:12px;"><span style="font-size:0.85rem; color:#555;">Choose <strong>Save as PDF</strong> in the print dialog.</span><button onclick="window.print()" style="background:#3498db; color:white; border:none; border-radius:4px; padding:8px 14px; font-weight:bold; cursor:pointer;">Print / Save PDF</button></div>${pages}<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script></body></html>`);
    w.document.close();
}
function exportSingleMenuItemCogsPdf(menuId) {
    const menu = getMenuForExport(menuId);
    if (!menu) return showToast('Menu item not found.', 'warning');
    generateMenuItemsCogsPdf([menu], `${menu.name || 'Menu Item'} COGS %`);
}
function exportAllMenuItemsCogsPdf() {
    syncCurrentMenuEditBeforeExport();
    const items = getFilteredMenuItemsForPptx().map(m => getMenuForExport(m.id)).filter(Boolean);
    if (items.length === 0) return showToast('No menu items match the current filter/search.', 'warning');
    generateMenuItemsCogsPdf(items, `${currentProperty || 'Property'} All Menu Item COGS %`);
}
function openBulkMenuCogsModal() {
    const list = document.getElementById('bulkMenuCogsList');
    list.innerHTML = '';
    document.getElementById('bulkMenuCogsSelectAll').checked = false;
    const menus = menuDatabase.filter(menu => menu.property === currentProperty).sort((a,b) => (a.name || '').localeCompare(b.name || ''));
    if (menus.length === 0) list.innerHTML = '<span style="color:#777;">No menu item recipes found for this property.</span>';
    else menus.forEach(menu => { const label = document.createElement('label'); label.style.cssText = 'display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #eee; cursor:pointer;'; label.innerHTML = `<input type="checkbox" class="bulk-menu-cogs-cb" value="${menu.id}"> ${escapeHtml(menu.name || 'Unnamed Item')}`; list.appendChild(label); });
    document.getElementById('bulkMenuCogsModal').style.display = 'block';
}
function toggleBulkMenuCogsSelectAll(cb) { document.querySelectorAll('.bulk-menu-cogs-cb').forEach(box => box.checked = cb.checked); }
function executeBulkMenuCogsExport() {
    const selected = [...document.querySelectorAll('.bulk-menu-cogs-cb:checked')].map(cb => cb.value);
    if (selected.length === 0) return showToast('Please select at least one menu item.', 'warning');
    const items = selected.map(id => getMenuForExport(id)).filter(Boolean);
    generateMenuItemsCogsPdf(items, `${currentProperty || 'Property'} Bulk Menu Item COGS %`);
    closeModal('bulkMenuCogsModal');
}

// ─── MENU ITEM PPTX EXPORT ───────────────────────────────────────────────────

function getFilteredMenuItemsForPptx() {
    const filterText = (document.getElementById('searchMenuInput')?.value || '').toLowerCase();
    const categoryFilter = document.getElementById('filterMenuCategory')?.value || 'All';
    const sortOrder = document.getElementById('sortMenuCost')?.value || 'alpha';

    let filteredData = menuDatabase.filter(m => m.property === currentProperty);

    if (filterText) {
        filteredData = filteredData.filter(m =>
            (m.name || '').toLowerCase().includes(filterText) ||
            (m.category || '').toLowerCase().includes(filterText)
        );
    }
    if (categoryFilter && categoryFilter !== 'All') {
        filteredData = filteredData.filter(m => m.category === categoryFilter);
    }

    if (sortOrder === 'high-low') {
        filteredData.sort((a, b) => calculateMenuCostPercentage(b) - calculateMenuCostPercentage(a) || (a.name || '').localeCompare(b.name || ''));
    } else if (sortOrder === 'low-high') {
        filteredData.sort((a, b) => calculateMenuCostPercentage(a) - calculateMenuCostPercentage(b) || (a.name || '').localeCompare(b.name || ''));
    } else {
        filteredData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    return filteredData;
}

function exportSingleMenuItemPptx(menuId) {
    const menu = getMenuForExport(menuId);
    if (!menu) return showToast("Menu item not found.", "warning");
    generateMenuItemPptx([menu]);
}

function exportAllMenuItemsPptx() {
    syncCurrentMenuEditBeforeExport();
    const items = getFilteredMenuItemsForPptx().map(m => getMenuForExport(m.id)).filter(Boolean);
    if (!items || items.length === 0) return showToast("No menu items match the current filter/search.", "warning");
    generateMenuItemPptx(items);
}

function openBulkMenuPptxModal() {
    const list = document.getElementById("bulkMenuPptxList");
    list.innerHTML = "";
    document.getElementById("bulkMenuPptxSelectAll").checked = false;

    const menus = menuDatabase
        .filter(menu => menu.property === currentProperty)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (menus.length === 0) {
        list.innerHTML = '<span style="color:#777;">No menu item recipes found for this property.</span>';
    } else {
        menus.forEach(menu => {
            const label = document.createElement("label");
            label.style.cssText = "display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #eee; cursor:pointer;";
            label.innerHTML = `<input type="checkbox" class="bulk-menu-pptx-cb" value="${menu.id}"> ${menu.name || "Unnamed Item"}`;
            list.appendChild(label);
        });
    }
    document.getElementById("bulkMenuPptxModal").style.display = "block";
}

function toggleBulkMenuPptxSelectAll(cb) {
    document.querySelectorAll(".bulk-menu-pptx-cb").forEach(box => box.checked = cb.checked);
}

function executeBulkMenuPptxExport() {
    const selected = [...document.querySelectorAll(".bulk-menu-pptx-cb:checked")].map(cb => cb.value);
    if (selected.length === 0) return showToast("Please select at least one menu item.", "warning");
    const items = selected.map(id => getMenuForExport(id)).filter(Boolean);
    generateMenuItemPptx(items);
    closeModal("bulkMenuPptxModal");
}

function generateMenuItemPptx(items) {
    const pptx = new PptxGenJS();

    const HACCP_TEXT = "HACCP: Measure all temperatures with a cleaned and sanitized thermometer. Wash hands before handling food, after handling raw foods, and after any activity that may contaminate hands. Wash, rinse, and sanitize all equipment and utensils before and after use. Return all ingredients to refrigerated storage if preparation is delayed or interrupted. Heat any product needed to an internal temperature reaches 165F CCP-1, transfer into an appropriate container and cool to 45F CCP-2 then cover, label and refrigerate below 40F CCP-3.";

  items.forEach(menu => {
        const slide = pptx.addSlide();

        // ── LEFT COLUMN: Image Placeholder Block ─────────────────────
        // This is intentionally a blank picture area so a photo can be pasted over it in PowerPoint.
        slide.addShape(pptx.ShapeType.rect, {
            x: 0.3, y: 0.25, w: 3.2, h: 4.3,
            fill: { color: "F7F7F7", transparency: 10 },
            line: { color: "999999", width: 1, dash: "dash" }
        });
        // Kept as a single clean rectangle only. Avoid diagonal line shapes here because some PowerPoint versions
        // can reject PPTX files when generated line shapes include negative height/width values.
        // To add a photo: select this box in PowerPoint, delete it, then paste or insert the image into the same area.

        // ── TOP RIGHT: Wide Recipe Title ─────────────────────────
        // Starts at the middle column and stretches all the way to the right edge
        slide.addText(menu.name || "Menu Item", {
            x: 3.7, y: 0.25, w: 5.9, h: 0.6,
            fontSize: 20, bold: true, color: "1a1a1a",
            fontFace: "Century Gothic",
            valign: "top",
            underline: { style: "sng", color: "1a1a1a" },
            wrap: true
        });
			
			slide.addText("Cook Time: " + (menu.cookTime || "N/A"), {
		    x: 3.7, y: 0.9, w: 2.8, h: 0.3,
		    fontSize: 11, bold: true, italic: true, color: "333333",
		    fontFace: "Century Gothic"
		});

        // ── MIDDLE COLUMN: Cook Time, Ingredients, Tips ──────────
        // Cook Time label 
        slide.addText("Cook Time:", {
            x: 3.7, y: 0.9, w: 2.8, h: 0.3,
            fontSize: 11, bold: true, italic: true, color: "333333",
            fontFace: "Century Gothic"
        });

        // INGREDIENTS label
        slide.addText("INGREDIENTS", {
            x: 3.7, y: 1.3, w: 2.8, h: 0.3,
            fontSize: 11, bold: true, color: "1a1a1a",
            fontFace: "Century Gothic",
            charSpacing: 3
        });

        // Ingredient list (credit/substitution rows are hidden from the kitchen card)
        const ingredients = getNonCreditIngredients(menu);
        const ingLines = ingredients.length > 0
            ? ingredients.map(ing => {
                const qtyUnit = `${ing.qty || ""} ${ing.unit || ""}`.trim();
                const ingName = ing.name || "";
                const lineText = qtyUnit ? `${qtyUnit}  —  ${ingName}` : ingName;
                return {
                    text: lineText,
                    options: { bullet: { type: "bullet", characterCode: "2022" }, fontSize: 9, color: "1a1a1a", fontFace: "Century Gothic", breakLine: true }
                };
            })
            : [{ text: "No ingredients listed.", options: { fontSize: 9, color: "777777", fontFace: "Century Gothic", breakLine: true } }];

        slide.addText(ingLines, {
            x: 3.7, y: 1.6, w: 2.8, h: 2.0,
            valign: "top", wrap: true
        });

        // TIPS / NOTES box
        slide.addShape(pptx.ShapeType.rect, {
            x: 3.7, y: 3.7, w: 2.8, h: 0.85,
            line: { color: "CCCCCC", width: 1 },
            fill: { color: "FFFFFF" }
        });
        slide.addText("TIPS / NOTES", {
            x: 3.75, y: 3.75, w: 2.7, h: 0.2,
            fontSize: 9, bold: true, color: "7B3F00",
            fontFace: "Century Gothic", charSpacing: 2
        });
        const tipsRaw = richTextToPlainText(menu.tipsNotes);
        if (tipsRaw) {
            slide.addText(tipsRaw, {
                x: 3.75, y: 3.95, w: 2.7, h: 0.55,
                fontSize: 9, color: "333333", fontFace: "Century Gothic",
                valign: "top", wrap: true
            });
        }

        // ── RIGHT COLUMN: Preparation ────────────────────────────
        // Shrunk by moving it down to start beneath the wide title
        slide.addText("PREPARATION", {
            x: 6.8, y: 0.9, w: 2.8, h: 0.35,
            fontSize: 13, bold: true, color: "1a1a1a",
            fontFace: "Century Gothic",
            charSpacing: 3
        });

        // Steps of Preparation
        const stepsRaw = richTextToPlainText(menu.steps, { dedupeAdjacentLines: false });
        slide.addText(stepsRaw || "No preparation steps listed.", {
            x: 6.8, y: 1.3, w: 2.8, h: 3.25,
            fontSize: 9, color: "1a1a1a", fontFace: "Century Gothic",
            valign: "top", wrap: true,
            bullet: { type: "number", style: "arabicPeriod" }
        });

        // ── BOTTOM: Full Width HACCP Footer ──────────────────────
        const hccapParts = [
            { text: "HACCP: ", options: { bold: true, fontSize: 8, color: "1a1a1a", fontFace: "Century Gothic" } },
            { text: HACCP_TEXT.replace("HACCP: ", ""), options: { bold: false, fontSize: 8, color: "1a1a1a", fontFace: "Century Gothic" } }
        ];
        slide.addText(hccapParts, {
            x: 0.3, y: 4.7, w: 9.3, h: 0.8,
            valign: "top", wrap: true,
            line: { color: "CCCCCC", width: 0.5, pt: "top" }
        });
    });

    pptx.writeFile({ fileName: `MenuItemRecipes_${Date.now()}.pptx` });
}

    

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',restoreLayoutPreference);else restoreLayoutPreference();
