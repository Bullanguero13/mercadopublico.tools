// ==UserScript==
// @name         Pegado rápido - Mercado Público (Modo Cálculo Seguro)
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Corrige el problema de cálculo de totales en SC mediante inyección secuencial.
// @author       Asistente de Programación
// @match        *://*.mercadopublico.cl/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // 💡 CONFIGURACIÓN
    const STORAGE_KEY_ENABLED = 'multiPasteEnabled';
    let isEnabled = GM_getValue(STORAGE_KEY_ENABLED, true);

    // TIEMPO DE ESPERA ENTRE FILAS (SC): Aumentar si tu internet es lento (en milisegundos)
    const SC_WAIT_TIME = 800;

    // DESCRIPCIÓN FIJA
    const USER_DESCRIPTION =
        `DESPACHO EN x DÍAS HÁBILES
 / CONTACTO: MARTÍN CHACÓN - EMAIL: mchacon@delmarchile.cl - TEL: +56 9 8952 5762
 / CONTACTO LOGÍSTICO +56 9 3391 5104
 / CONTACTO FINANZAS +56 9 3414 4996`;

    // --- UTILIDADES ---
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const cleanNumericValue = (value) => value.replace(/[^\d]/g, ''); // Limpia todo lo que no sea numero
    const isVisible = (elem) => !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length);

    // Actualiza el texto del botón flotante
    const updateStatus = (text, color = null) => {
        const statusSpan = document.getElementById('switch-status-label');
        if (statusSpan) {
            statusSpan.textContent = text;
            if (color) statusSpan.style.backgroundColor = color;
        }
    };

    // FUNCIÓN: Inyectar valor en un elemento
    const setElementValue = (element, value, isInput) => {
        let cleanedValue = value;
        // En SC (ASP.NET) a veces es mejor enviar el numero limpio, el input mask lo formatea despues
        if (isInput) cleanedValue = cleanNumericValue(value);

        const elementPrototype = isInput ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const valueSetter = Object.getOwnPropertyDescriptor(elementPrototype, 'value').set;

        if (valueSetter) {
            valueSetter.call(element, cleanedValue);
        } else {
            element.value = cleanedValue;
        }

        // Disparar eventos estándar
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true })); // Esto dispara el PostBack en SC
    };

    // --- LÓGICA PRINCIPAL ---
    const handlePaste = async (event) => {
        if (!isEnabled) return;

        const targetElement = event.target;
        const tagName = targetElement.tagName;
        // Permitir pegado normal en inputs si no hay saltos de linea
        const clipboardData = event.clipboardData || window.window.clipboardData;
        const pastedText = clipboardData.getData('text');
        const isMultiPaste = pastedText && (pastedText.includes('\n') || pastedText.includes('\r'));

        if ((tagName === 'INPUT' || tagName === 'TEXTAREA') && !isMultiPaste) return;
        if (!isMultiPaste) return;

        event.stopPropagation();
        event.preventDefault();

        const cellValues = pastedText.trim().split(/\r?\n/).filter(v => v.trim() !== '');

        // --- DETECCIÓN DE PÁGINA ---
        // Buscamos si existe algun input con el ID caracteristico de SC
        const scInputsCheck = document.querySelectorAll('input[id*="gvtxtMontoUnitario"]');
        const isSC = scInputsCheck.length > 0;

        if (isSC) {
            // === MODO SC (ASP.NET WebForms) - SECUENCIAL ===
            console.log("Modo SC detectado: Iniciando pegado secuencial...");
            updateStatus("Preparando...", "#e67e22");

            for (let i = 0; i < cellValues.length; i++) {
                // 1. IMPORTANTE: Re-seleccionar los inputs en CADA vuelta.
                // Como la página se recarga (AJAX) en cada paso, los elementos DOM anteriores mueren.
                // Necesitamos encontrar los "nuevos" inputs frescos.
                const currentInputs = Array.from(document.querySelectorAll('input[id*="gvtxtMontoUnitario"]'))
                                           .filter(input => isVisible(input) && !input.readOnly && !input.disabled);

                if (i >= currentInputs.length) break;

                const input = currentInputs[i];
                const value = cellValues[i];

                // Actualizar interfaz visual
                updateStatus(`Pegando ${i + 1}/${cellValues.length}...`, "#e67e22");

                // 2. Inyectar valor y disparar el cálculo
                input.focus();
                setElementValue(input, value, true);

                // 3. ESPERAR A QUE LA PÁGINA CALCULE (AJAX)
                // Esperamos un tiempo prudente para que el servidor responda y actualice la tabla
                await sleep(SC_WAIT_TIME);
            }

            // Inyectar descripción al final
            const descArea = document.getElementById('txtDetalleCotizacion');
            if (descArea) {
                setElementValue(descArea, USER_DESCRIPTION.trim(), false);
            }

            updateStatus("ON", "#27ae60"); // Volver a verde
            console.log("Proceso SC terminado.");

        } else {
            // === MODO COT (REACT / COMPRA ÁGIL) - RÁPIDO ===
            console.log("Modo COT detectado: Pegado rápido.");

            // Lógica React (Selectores ofuscados)
            const specificLabelClass = 'label.sc-cZDnYu.cgqfCZ';
            const containerClass = '.sc-bsKGAf.bXVsJz';
            const specificInputClass = '.sc-gMsgpL.lSucd.MuiInputBase-input.MuiInputBase-inputAdornedStart';

            let textInputs = [];
            document.querySelectorAll(specificLabelClass).forEach(label => {
                if (label.textContent.trim() === 'Valor unitario') {
                    const parentDiv = label.closest(containerClass);
                    if (parentDiv) {
                        const input = parentDiv.querySelector(`input[type="text"]${specificInputClass}`);
                        if (input && isVisible(input)) textInputs.push(input);
                    }
                }
            });

            if (textInputs.length === 0) return;

            // En React podemos ir rápido porque no recarga la página
            for (let i = 0; i < cellValues.length; i++) {
                if (i >= textInputs.length) break;
                setElementValue(textInputs[i], cellValues[i], true);
                await sleep(50);
            }

            // Descripción React - Selector robusto (ignora el campo oculto readonly)
            const descAreaReact = document.querySelector('textarea.sc-eboafE:not([readonly])');

            if (descAreaReact) {
                console.log("Descripción encontrada en modo COT. Inyectando...");
                await sleep(200);
                setElementValue(descAreaReact, USER_DESCRIPTION.trim(), false);
            } else {
                console.warn("No se encontró el textarea de descripción en modo COT.");
            }
        }
    };

    document.addEventListener('paste', handlePaste, true);

    // --- INTERFAZ FLOTANTE ---
    const initFloatingSwitch = () => {
        GM_addStyle(`
            #floating-switch-container {
                position: fixed; top: 20px; right: 20px;
                background-color: #34495e; color: white;
                padding: 8px 12px; border-radius: 8px;
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
                cursor: pointer; font-family: Arial, sans-serif; font-size: 14px;
                z-index: 99999; display: flex; align-items: center; gap: 8px; opacity: 0.95;
            }
            .switch-status { font-weight: bold; padding: 2px 6px; border-radius: 4px; }
            .switch-status.on { background-color: #27ae60; color: white; } /* Verde */
            .switch-status.off { background-color: #e74c3c; color: white; } /* Rojo */
        `);

        const container = document.createElement('div');
        container.id = 'floating-switch-container';
        container.innerHTML = '<span>Pegado:</span><span id="switch-status-label" class="switch-status on">ON</span>';
        document.body.appendChild(container);

        container.addEventListener('click', () => {
            isEnabled = !isEnabled;
            GM_setValue(STORAGE_KEY_ENABLED, isEnabled);
            const statusSpan = document.getElementById('switch-status-label');
            statusSpan.textContent = isEnabled ? 'ON' : 'OFF';
            statusSpan.className = `switch-status ${isEnabled ? 'on' : 'off'}`;
            statusSpan.style.backgroundColor = ''; // Limpiar colores personalizados
        });
    };

    // Esperar a que cargue el body
    const waitBody = setInterval(() => {
        if (document.body) {
            clearInterval(waitBody);
            initFloatingSwitch();
        }
    }, 100);

})();