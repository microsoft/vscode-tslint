export class MruCache<T> {

    private readonly _map = new Map<string, T>();
    private readonly _entries = new Set<string>();

    public constructor(
        private readonly _maxSize: number
    ) {}

    public set(filePath: string, entry: T): void {
        this._map.set(filePath, entry);
        this._entries.add(filePath);
        for (const key of this._entries.keys()) {
            if (this._entries.size <= this._maxSize) {
                break;
            }
            this._map.delete(key);
            this._entries.delete(key);
        }
    }

    public has(filePath: string): boolean {
        return this._map.has(filePath);
    }

    public get(filePath: string): (T) | undefined {
        if (this._entries.has(filePath)) {
            this._entries.delete(filePath);
            this._entries.add(filePath);
        }
        return this._map.get(filePath);
    }
}