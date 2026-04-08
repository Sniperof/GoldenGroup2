import { useState, useCallback } from 'react';
import { MapPin, Navigation, X } from 'lucide-react';

interface MapPickerProps {
    position: [number, number] | null;
    onLocationSelect: (lat: number, lng: number) => void;
}

const SYRIA_CENTER: [number, number] = [33.5138, 36.2765];

export default function MapPicker({ position, onLocationSelect }: MapPickerProps) {
    const [manualLat, setManualLat] = useState(position ? String(position[0]) : '');
    const [manualLng, setManualLng] = useState(position ? String(position[1]) : '');
    const [locating, setLocating] = useState(false);

    const center = position || SYRIA_CENTER;
    const zoom = position ? 15 : 7;

    // OpenStreetMap embed URL with a marker
    const mapUrl = position
        ? `https://www.openstreetmap.org/export/embed.html?bbox=${position[1] - 0.01},${position[0] - 0.005},${position[1] + 0.01},${position[0] + 0.005}&layer=mapnik&marker=${position[0]},${position[1]}`
        : `https://www.openstreetmap.org/export/embed.html?bbox=35.5,32.5,42.5,37.5&layer=mapnik`;

    const getCurrentLocation = useCallback(() => {
        if (!navigator.geolocation) {
            alert('المتصفح لا يدعم تحديد الموقع');
            return;
        }
        setLocating(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                setManualLat(lat.toFixed(6));
                setManualLng(lng.toFixed(6));
                onLocationSelect(lat, lng);
                setLocating(false);
            },
            () => {
                alert('تعذّر تحديد الموقع. تأكد من صلاحيات الموقع.');
                setLocating(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }, [onLocationSelect]);

    const applyManual = () => {
        const lat = parseFloat(manualLat);
        const lng = parseFloat(manualLng);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            onLocationSelect(lat, lng);
        }
    };

    const clearLocation = () => {
        setManualLat('');
        setManualLng('');
        onLocationSelect(0, 0);
    };

    return (
        <div className="space-y-2">
            {/* Map iframe */}
            <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm relative" style={{ height: 180 }}>
                <iframe
                    src={mapUrl}
                    style={{ width: '100%', height: '100%', border: 0 }}
                    allowFullScreen
                    loading="lazy"
                    title="خريطة الموقع"
                />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
                {/* GPS button */}
                <button
                    type="button"
                    onClick={getCurrentLocation}
                    disabled={locating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-medium transition-all disabled:opacity-50 shrink-0"
                >
                    <Navigation className={`w-3.5 h-3.5 ${locating ? 'animate-pulse' : ''}`} />
                    <span>{locating ? 'جاري التحديد...' : 'موقعي الحالي'}</span>
                </button>

                {/* Lat */}
                <input
                    type="text"
                    value={manualLat}
                    onChange={e => setManualLat(e.target.value)}
                    onBlur={applyManual}
                    placeholder="Lat"
                    dir="ltr"
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-700 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none text-center"
                />

                {/* Lng */}
                <input
                    type="text"
                    value={manualLng}
                    onChange={e => setManualLng(e.target.value)}
                    onBlur={applyManual}
                    placeholder="Lng"
                    dir="ltr"
                    className="flex-1 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-700 placeholder:text-gray-300 focus:border-sky-500 focus:outline-none text-center"
                />

                {/* Clear */}
                {position && (
                    <button type="button" onClick={clearLocation} className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 border border-transparent hover:border-red-100 transition-all shrink-0">
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
        </div>
    );
}
