import { app } from "../../scripts/app.js";

const seedNodes = ["myEasySeedxxx", ]
const imageNodes = ["myImageSizexxx", ]

app.registerExtension({
	name: "comfy.myTestNode.dynamicWidgets",

    async nodeCreated(node) {
        if (["myImageSizexxx"].includes(node.comfyClass)) {
			const inputEl = document.createElement("textarea");
			//inputEl.className = "comfy-multiline-input";
			inputEl.readOnly = true
			const widget = node.addDOMWidget("info", "customtext", inputEl, {
				getValue() {
					return inputEl.value;
				},
				setValue(v) {
					inputEl.value = v;
				},
				serialize: false
			});
			widget.inputEl = inputEl;
			inputEl.addEventListener("input", () => {
				widget.callback?.(widget.value);
			});
        }
    },

	async beforeRegisterNodeDef(nodeType, nodeData, app) {
		if (seedNodes.includes(nodeData.name)) {
			const onNodeCreated = nodeType.prototype.onNodeCreated;
			nodeType.prototype.onNodeCreated = async function () {
				onNodeCreated ? onNodeCreated.apply(this, []) : undefined;
				const seed_widget = this.widgets.find(w => ['seed_num','seed'].includes(w.name))
				const seed_control = this.widgets.find(w=> ['control_before_generate','control_after_generate'].includes(w.name))
				if(nodeData.name == 'myEasySeedxxx'){
					const randomSeedButton = this.addWidget("button", "🎲 Manual Random Seed", null, _=>{
						if(seed_control.value != 'fixed') seed_control.value = 'fixed'
						seed_widget.value = Math.floor(Math.random() * 1125899906842624)
						app.queuePrompt(0, 1)
					},{ serialize:false})
					seed_widget.linkedWidgets = [randomSeedButton, seed_control];
				}
			}
			const onAdded = nodeType.prototype.onAdded;
			nodeType.prototype.onAdded = async function () {
				onAdded ? onAdded.apply(this, []) : undefined;
				const seed_widget = this.widgets.find(w => ['seed_num','seed'].includes(w.name))
				const seed_control = this.widgets.find(w=> ['control_before_generate','control_after_generate'].includes(w.name))
				setTimeout(_=>{
					if(seed_control.name == 'control_before_generate' && seed_widget.value === 0) {
						seed_widget.value = Math.floor(Math.random() * 1125899906842624)
					}
				},1)
			}
		}

		if (imageNodes.includes(nodeData.name)) {
			function populate(arr_text) {
				var text = '';
				for (let i = 0; i < arr_text.length; i++){
					text += arr_text[i];
				}
				if (this.widgets) {
					const pos = this.widgets.findIndex((w) => w.name === "info");
					if (pos !== -1 && this.widgets[pos]) {
						const w = this.widgets[pos]
						w.value = text;
					}
				}
				requestAnimationFrame(() => {
					const sz = this.computeSize();
					if (sz[0] < this.size[0]) {
						sz[0] = this.size[0];
					}
					if (sz[1] < this.size[1]) {
						sz[1] = this.size[1];
					}
					this.onResize?.(sz);
					app.graph.setDirtyCanvas(true, false);
				});
			}

			// When the node is executed we will be sent the input text, display this in the widget
			const onExecuted = nodeType.prototype.onExecuted;
			nodeType.prototype.onExecuted = function (message) {
				onExecuted?.apply(this, arguments);
				populate.call(this, message.text);
			};			
		}
	}
});

