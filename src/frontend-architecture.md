# Arquitectura Frontend (React Native / PWA React)

Para escalar el **Pasaporte de Seguridad** a producción y cumplir con la UX de una herramienta exigente e industrial, este es el patrón arquitectónico base que el equipo Frontend debe estructurar y consumir usando el Endpoint de Node.js provisto.

---

## 1. Estructura de Directorios (React Native / NextJS PWA)
\`\`\`text
/src
  ├── assets/          # Iconos locales (Material Symbols SVG)
  ├── components/
  │    ├── common/     # <GlassCard/>, <ActionBtn/>, <NavBottom/>
  │    ├── cazadores/  # Componente SOS Cámara
  │    ├── ecTool/     # <SwipeableDeck/> (Librería reanimated Swipe)
  │    └── forms/      # <DebounceSearchInput/> para Kudos
  ├── config/
  │    └── axios.js    # Instancia HTTP con inyección automática de JWT
  ├── hooks/           # Custon Hooks (e.g. useKudos.js, useRefreshSession.js)
  ├── navigation/      # React Navigation (Native) o Routers React-router
  ├── screens/         # Home, Register, KudosTabs, QrScanner
  ├── store/           # Zustand (Lógica de Estado Global)
  │    └── useAuthStore.js
  └── utils/           # Constantes (e.g. EC_CARDS), Helpers de fecha.
\`\`\`

---

## 2. Estado Global (Zustand)
Para evitar "Prop Drilling" y tener los puntos y niveles disponibles en toda la app sin latencia visual. Recomiendo **Zustand**.

\`\`\`javascript
// src/store/useAuthStore.js
import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  userToken: null,
  userProfile: null, // Incluye { id, pts, nivel_actual }
  
  signIn: async (token, db_profile) => {
    // Save to SecureStore (React Native) o LocalStorage (Zustand Persist)
    set({ userToken: token, userProfile: db_profile });
  },
  
  refreshPoints: (addedPts) => {
    // Optimsitic UI Update: Añade puntos a la UI para gratificación instantánea 
    // mientras la API resuelve el POST real.
    set((state) => ({ 
       userProfile: { 
          ...state.userProfile, 
          pts: state.userProfile.pts + addedPts 
       } 
    }));
  }
}));
\`\`\`

---

## 3. Características Nativas & Librerías Core Módulos
Al saltar de la actual Versión VanillaJS a React/React Native Híbrido:

### 3.1. Módulo "Certificaciones & Briefing"
Para renderizar el QR temporal del Supervisor (`PRE-JOB`) o escanear sellos, el Frontend requerirá implementaciones profundas en el hardware:
* **Escaneo de QR:** Usar \`react-native-vision-camera\` (nativa) o \`html5-qrcode\` si se compila como PWA estricta. Interceptará la String token firmada (\`scannedToken\`) y la enviará al endpoint genérico \`/api/briefing/scan\`.
* **Renderizado de QR:** \`react-native-qrcode-svg\` que generará el Canvas visual a partir del Payload que te envía nuestro Node.js en \`/start\`.

### 3.2. Módulo "Cazadores de Señales" y S3 (Foto Perfil)
Subscripciones asíncronas de Blob data:
* Al activar la cámara emergente o elegir del *CameraRoll* (\`expo-image-picker\`), la app recogerá el *File* object y lo mandará directamente al Frontend a una URL firmada de **AWS S3** o *en stream multipart/* al Node.js (según config presigned url) devolviendo la \`<URL_PUBLICA_FOTO>\` a guardar en Postgres.

### 3.3. Buscador de Kudos "Debouncing"
El campo de búsqueda de Kudos (`/api/users/search`) usa el motor PostgreSQL directamente. Para no congelar el servidor industrial tecleando, los *Hooks* deben implementar el AntiRebote:
\`\`\`javascript
// Ejemplo del flow en React
import { useDebounce } from 'use-debounce';

const [query, setQuery] = useState('');
const [value] = useDebounce(query, 500); // <- Espera 0.5s al cesar la escritura 
useEffect(() => {
   if(value.length > 2) fetchKudosApi(value);
}, [value]);
\`\`\`
