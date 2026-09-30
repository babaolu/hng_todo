export type Toast = {
	id: number;
	message: string;
	action?: { label: string; run: () => void };
};

let nextId = 1;

class Toasts {
	items = $state<Toast[]>([]);

	show(message: string, action?: Toast['action'], timeout = 5000) {
		const toast = { id: nextId++, message, action };
		this.items = [...this.items.slice(-2), toast];
		setTimeout(() => this.dismiss(toast.id), timeout);
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();
