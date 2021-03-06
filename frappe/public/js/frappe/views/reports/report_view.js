/**
 * frappe.views.ReportView
 */
frappe.provide('frappe.views');

frappe.views.ReportView = class ReportView extends frappe.views.ListView {
	setup_defaults() {
		super.setup_defaults();
		this.page_title = __('Report:') + ' ' + this.page_title;
		this.menu_items = this.report_menu_items();

		const route = frappe.get_route();
		if (route.length === 4) {
			this.report_name = route[3];
		}

		this.add_totals_row = this.view_user_settings.add_totals_row || 0;

		if (this.report_name) {
			return this.get_report_doc()
				.then(doc => {
					this.report_doc = doc;
					this.report_doc.json = JSON.parse(this.report_doc.json);

					this.filters = this.report_doc.json.filters;
					this.order_by = this.report_doc.json.order_by;
					this.add_totals_row = this.report_doc.json.add_totals_row;
					this.page_title = this.report_name;
				});
		}
	}

	setup_view() {
		this.setup_columns();
	}

	before_render() {
		this.save_report_settings();
	}

	save_report_settings() {
		frappe.model.user_settings.save(this.doctype, 'last_view', this.view_name);

		if (!this.report_name) {
			this.save_view_user_settings({
				fields: this._fields,
				filters: this.filter_area.get(),
				order_by: this.sort_selector.get_sql_string(),
				add_totals_row: this.add_totals_row
			});
		}
	}

	update_data(r) {
		let data = r.message || {};
		data = frappe.utils.dict(data.keys, data.values);

		if (this.start === 0) {
			this.data = data;
		} else {
			this.data = this.data.concat(data);
		}
	}

	render() {
		if (this.datatable) {
			this.datatable.refresh(this.get_data(this.data));
			return;
		}
		this.setup_datatable(this.data);
	}

	on_update(data) {
		if (this.doctype === data.doctype && data.name) {
			// flash row when doc is updated by some other user
			const flash_row = data.user !== frappe.session.user;
			if (this.data.find(d => d.name === data.name)) {
				// update existing
				frappe.db.get_doc(data.doctype, data.name)
					.then(doc => this.update_row(doc, flash_row));
			} else {
				// refresh
				this.refresh();
			}
		}
	}

	update_row(doc, flash_row) {
		// update this.data
		const data = this.data.find(d => d.name === doc.name);
		const rowIndex = this.data.findIndex(d => d.name === doc.name);
		if (!data) return;

		for (let fieldname in data) {
			data[fieldname] = doc[fieldname];
		}

		const new_row = this.build_row(data);
		this.datatable.refreshRow(new_row, rowIndex);

		// indicate row update
		if (flash_row) {
			const $row = this.$result.find(`.data-table-row[data-row-index="${rowIndex}"]`);
			$row.addClass('row-update');
			setTimeout(() => $row.removeClass('row-update'), 500);
		}
	}

	setup_datatable(values) {
		this.datatable = new DataTable(this.$result[0], {
			data: this.get_data(values),
			enableClusterize: true,
			addCheckbox: this.can_delete,
			takeAvailableSpace: true,
			editing: this.get_editing_object.bind(this),
			events: {
				onRemoveColumn: (column) => {
					this.remove_column_from_datatable(column);
				},
				onSwitchColumn: (column1, column2) => {
					this.switch_column(column1, column2);
				}
			},
			headerDropdown: [{
				label: __('Add Column'),
				action: (datatabe_col) => {
					let columns_in_picker = [];
					const columns = this.get_columns_for_picker();

					columns_in_picker = columns[this.doctype]
						.filter(df => !this.is_column_added(df))
						.map(df => ({
							label: __(df.label),
							value: df.fieldname
						}));

					delete columns[this.doctype];

					for (let cdt in columns) {
						columns[cdt]
							.filter(df => !this.is_column_added(df))
							.map(df => ({
								label: __(df.label) + ` (${cdt})`,
								value: df.fieldname + ',' + cdt
							}))
							.forEach(df => columns_in_picker.push(df));
					}

					const d = new frappe.ui.Dialog({
						title: __('Add Column'),
						fields: [
							{
								label: __('Select Column'),
								fieldname: 'column',
								fieldtype: 'Autocomplete',
								options: columns_in_picker
							},
							{
								label: __('Insert Column Before {0}', [datatabe_col.docfield.label.bold()]),
								fieldname: 'insert_before',
								fieldtype: 'Check'
							}
						],
						primary_action: ({ column, insert_before }) => {

							let doctype = this.doctype;
							if (column.includes(',')) {
								[column, doctype] = column.split(',');
							}

							let index = datatabe_col.colIndex;
							if (insert_before) {
								index = index - 1;
							}

							this.add_column_to_datatable(column, doctype, index);
							d.hide();
						}
					});

					d.show();
				}
			}]
		});

	}

	get_editing_object(colIndex, rowIndex, value, parent) {
		const control = this.render_editing_input(colIndex, value, parent);
		if (!control) return false;

		return {
			initValue: (value) => {
				control.set_focus();
				return control.set_value(value);
			},
			setValue: (value) => {
				const cell = this.datatable.getCell(colIndex, rowIndex);
				let fieldname = this.datatable.getColumn(colIndex).docfield.fieldname;
				let docname = cell.name;

				control.set_value(value);
				return this.set_control_value(docname, fieldname, value);
			},
			getValue: () => {
				return control.get_value();
			}
		};
	}

	set_control_value(docname, fieldname, value) {
		this.last_updated_doc = docname;
		return new Promise((resolve, reject) => {
			frappe.db.set_value(this.doctype, docname, {[fieldname]: value})
				.then(r => {
					if (r.message) {
						resolve();
					} else {
						reject();
					}
				})
				.fail(reject);
		});
	}

	render_editing_input(colIndex, value, parent) {
		const col = this.datatable.getColumn(colIndex);

		// make control
		const control = frappe.ui.form.make_control({
			df: col.docfield,
			parent: parent,
			render_input: true
		});
		control.set_value(value);
		control.toggle_label(false);
		control.toggle_description(false);

		return control;
	}

	is_editable(df, data) {
		if (!df || data.docstatus !== 0) return false;
		const is_standard_field = frappe.model.std_fields_list.includes(df.fieldname);
		const can_edit = !(
			is_standard_field
			|| df.read_only
			|| df.hidden
			|| !frappe.model.can_write(this.doctype)
		);
		return can_edit;
	}

	get_data(values) {
		return {
			columns: this.columns,
			rows: this.build_rows(values)
		};
	}

	set_fields() {
		if (this.report_name) {
			this._fields = this.report_doc.json._fields;
			return;
		}

		// get from user_settings
		else if (this.view_user_settings.fields) {
			this._fields = this.view_user_settings.fields;
			return;
		}

		// get fields from meta
		this._fields = [];
		const add_field = f => this._add_field(f);

		// default fields
		[
			'name', 'docstatus',
			this.meta.title_field,
			this.meta.image_field
		].map(add_field);

		// fields in_list_view or in_standard_filter
		const fields = this.meta.fields.filter(df => {
			return (df.in_list_view || df.in_standard_filter)
				&& frappe.perm.has_perm(this.doctype, df.permlevel, 'read')
				&& frappe.model.is_value_type(df.fieldtype)
				&& !df.report_hide;
		});

		fields.map(add_field);

		// currency fields
		fields.filter(
			df => df.fieldtype === 'Currency' && df.options
		).map(df => {
			if (df.options.includes(':')) {
				add_field(df.options.split(':')[1]);
			} else {
				add_field(df.options);
			}
		});

		// fields in listview_settings
		(this.settings.add_fields || []).map(add_field);
	}

	build_fields() {
		this._fields.push(['docstatus', this.doctype]);
		super.build_fields();
	}

	add_column_to_datatable(fieldname, doctype, col_index) {
		const field = [fieldname, doctype];
		this._fields.splice(col_index, 0, field);

		this.build_fields();
		this.setup_columns();

		this.datatable.destroy();
		this.datatable = null;
		this.refresh();
	}

	remove_column_from_datatable(column) {
		const index = this._fields.findIndex(f => column.field === f[0]);
		if (index === -1) return;
		const field = this._fields[index];
		if (field[0] === 'name') {
			frappe.throw(__('Cannot remove ID field'));
		}
		this._fields.splice(index, 1);
		this.build_fields();
		this.setup_columns();
		this.refresh();
	}

	switch_column(col1, col2) {
		const index1 = this._fields.findIndex(f => col1.field === f[0]);
		const index2 = this._fields.findIndex(f => col2.field === f[0]);
		const _fields = this._fields.slice();

		let temp = _fields[index1];
		_fields[index1] = _fields[index2];
		_fields[index2] = temp;

		this._fields = _fields;
		this.build_fields();
		this.setup_columns();
		this.save_report_settings();
	}

	get_columns_for_picker() {
		let out = {};
		let doctype_fields = frappe.meta.get_docfields(this.doctype).filter(df =>
			!in_list(frappe.model.no_value_type, df.fieldtype) &&
			!df.report_hide && df.fieldname !== 'naming_series' &&
			!df.hidden
		);

		doctype_fields = [{
			label: __('ID'),
			fieldname: 'name',
			fieldtype: 'Data'
		}].concat(doctype_fields);

		out[this.doctype] = doctype_fields;

		const table_fields = frappe.meta.get_table_fields(this.doctype)
			.filter(df => !df.hidden);

		table_fields.forEach(df => {
			const cdt = df.options;
			const child_table_fields =
				frappe.meta.get_docfields(cdt)
					.filter(df => df.in_list_view);

			out[cdt] = child_table_fields;
		});

		return out;
	}

	get_dialog_fields() {
		const dialog_fields = [];
		const columns = this.get_columns_for_picker();

		dialog_fields.push({
			label: __(this.doctype),
			fieldname: this.doctype,
			fieldtype: 'MultiCheck',
			columns: 2,
			options: columns[this.doctype]
				.map(df => ({
					label: __(df.label),
					value: df.fieldname,
					checked: this._fields.find(f => f[0] === df.fieldname)
				}))
		});

		delete columns[this.doctype];

		const table_fields = frappe.meta.get_table_fields(this.doctype)
			.filter(df => !df.hidden);

		table_fields.forEach(df => {
			const cdt = df.options;

			dialog_fields.push({
				label: __(df.label) + ` (${__(cdt)})`,
				fieldname: df.options,
				fieldtype: 'MultiCheck',
				columns: 2,
				options: columns[cdt]
					.map(df => ({
						label: __(df.label),
						value: df.fieldname,
						checked: this._fields.find(f => f[0] === df.fieldname && f[1] === cdt)
					}))
			});
		});

		return dialog_fields;
	}

	is_column_added(df) {
		return Boolean(
			this._fields.find(f => f[0] === df.fieldname && df.parent === f[1])
		);
	}

	setup_columns() {
		const hide_columns = ['docstatus'];
		const fields = this._fields.filter(f => !hide_columns.includes(f[0]));
		this.columns = fields.map(f => this.build_column(f));
	}

	build_column(c) {
		let [fieldname, doctype] = c;
		let docfield = frappe.meta.docfield_map[doctype || this.doctype][fieldname];

		if (!docfield) {
			docfield = frappe.model.get_std_field(fieldname);

			if (docfield) {
				docfield.parent = this.doctype;
				if (fieldname == "name") {
					docfield.options = this.doctype;
				}
			}
		}
		if (!docfield) return;

		const title = __(docfield ? docfield.label : toTitle(fieldname));
		const editable = frappe.model.is_non_std_field(fieldname) && !docfield.read_only;

		return {
			id: fieldname,
			field: fieldname,
			docfield: docfield,
			name: title,
			content: title, // required by datatable
			width: (docfield ? cint(docfield.width) : 120) || 120,
			editable: editable
		};
	}

	build_rows(data) {
		const out = data.map(d => this.build_row(d));

		if (this.add_totals_row) {
			const totals_row = data.reduce((totals_row, d) => {
				this.columns.forEach((col, i) => {
					totals_row[i] = totals_row[i] || {
						name: 'Totals Row',
						content: ''
					};

					if (col.field in d && frappe.model.is_numeric_field(col.docfield)) {

						if (!totals_row[i].format) {
							totals_row[i].format = value => frappe.format(value, col.docfield, { always_show_decimals: true });
						}

						totals_row[i].content = totals_row[i].content || 0;
						totals_row[i].content += parseInt(d[col.field], 10);
					}
				});

				return totals_row;
			}, []);

			totals_row[0].content = __('Totals').bold();

			out.push(totals_row);
		}

		return out;
	}

	build_row(d) {
		return this.columns.map(col => {
			if (col.field in d) {
				const value = d[col.field];
				return {
					name: d.name,
					content: value,
					editable: this.is_editable(col.docfield, d),
					format: value => {
						if (col.field === 'name') {
							return frappe.utils.get_form_link(this.doctype, value, true);
						}
						return frappe.format(value, col.docfield, { always_show_decimals: true });
					}
				};
			}
			return {
				content: ''
			};
		});
	}

	get_checked_items(only_docnames) {
		const indexes = this.datatable.rowmanager.getCheckedRows();
		const items = indexes.filter(i => i != undefined)
			.map(i => this.data[i]);

		if (only_docnames) {
			return items.map(d => d.name);
		}

		return items;
	}

	save_report(save_type) {
		const _save_report = (name) => {
			// callback
			return frappe.call({
				method: 'frappe.desk.reportview.save_report',
				args: {
					name: name,
					doctype: this.doctype,
					json: JSON.stringify({
						filters: this.filter_area.get(),
						_fields: this._fields,
						order_by: this.sort_selector.get_sql_string(),
						add_totals_row: this.add_totals_row
					})
				},
				callback:(r) => {
					if(r.exc) {
						frappe.msgprint(__("Report was not saved (there were errors)"));
						return;
					}
					if(r.message != this.report_name) {
						frappe.set_route('List', this.doctype, 'Report', r.message);
					}
				}
			});

		};

		if(this.report_name && save_type == "save") {
			_save_report(this.report_name);
		} else {
			frappe.prompt({fieldname: 'name', label: __('New Report name'), reqd: 1, fieldtype: 'Data'}, (data) => {
				_save_report(data.name);
			}, __('Save As'));
		}
	}

	get_report_doc() {
		return new Promise(resolve => {
			frappe.model.with_doc('Report', this.report_name, () => {
				resolve(frappe.get_doc('Report', this.report_name));
			});
		});
	}

	report_menu_items() {
		let items = [
			{
				label: __('Show Totals'),
				action: () => {
					this.add_totals_row = !this.add_totals_row;
					this.save_view_user_settings({ add_totals_row: this.add_totals_row });
					this.datatable.refresh(this.get_data(this.data));
				}
			},
			{
				label: __('Print'),
				action: () => {
					frappe.ui.get_print_settings(false, (print_settings) => {
						var title =  __(this.doctype);
						frappe.render_grid({
							title: title,
							print_settings: print_settings,
							columns: this.columns,
							data: this.data
						});
					});
				}
			},
			{
				label: __('Pick Columns'),
				action: () => {
					const d = new frappe.ui.Dialog({
						title: __('Pick Columns'),
						fields: this.get_dialog_fields(),
						primary_action: (values) => {
							// doctype fields
							let fields = values[this.doctype].map(f => [f, this.doctype]);
							delete values[this.doctype];

							// child table fields
							for (let cdt in values) {
								fields = fields.concat(values[cdt].map(f => [f, cdt]));
							}

							// this._fields = this._fields.concat(fields);
							this._fields = fields;

							this.build_fields();
							this.setup_columns();

							this.datatable.destroy();
							this.datatable = null;
							this.refresh();

							d.hide();
						}
					});

					d.show();
				}
			}
		];

		if (frappe.model.can_export(this.doctype)) {
			items.push({
				label: __('Export'),
				action: () => {
					const args = this.get_args();
					const selected_items = this.get_checked_items(true);

					frappe.prompt({
						fieldtype:"Select", label: __("Select File Type"), fieldname:"file_format_type",
						options:"Excel\nCSV", default:"Excel", reqd: 1
					},
					(data) => {
						args.cmd = 'frappe.desk.reportview.export_query';
						args.file_format_type = data.file_format_type;

						if(this.add_totals_row) {
							args.add_totals_row = 1;
						}

						if(selected_items.length > 0) {
							args.selected_items = selected_items;
						}
						open_url_post(frappe.request.url, args);
					},
					__("Export Report: {0}",[__(this.doctype)]), __("Download"));
				}
			});
		}

		items.push({
			label: __("Setup Auto Email"),
			action: () => {
				if(this.report_name) {
					frappe.set_route('List', 'Auto Email Report', {'report' : this.report_name});
				} else {
					frappe.msgprint(__('Please save the report first'));
				}
			}
		});

		// save buttons
		if(frappe.user.is_report_manager()) {
			items = items.concat([
				{ label: __('Save'), action: () => this.save_report('save') },
				{ label: __('Save As'), action: () => this.save_report('save_as') }
			]);
		}

		// user permissions
		if(this.report_name && frappe.model.can_set_user_permissions("Report")) {
			items.push({
				label: __("User Permissions"),
				action: () => {
					const args = {
						doctype: "Report",
						name: this.report_name
					};
					frappe.set_route('List', 'User Permission', args);
				}
			});
		}

		// add to desktop
		items.push({
			label: __('Add to Desktop'),
			action: () => {
				frappe.add_to_desktop(
					this.report_name || __('{0} Report', [this.doctype]),
					this.doctype, this.report_name
				);
			}
		});

		return items.map(i => Object.assign(i, { standard: true }));
	}

};
