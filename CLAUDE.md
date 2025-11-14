# CLAUDE.md - AI Assistant Guide for Docupaca

> **Last Updated:** 2025-11-14
> **Project:** Docupaca (ドキュパカ！) - AI-powered OCR management application

This document provides comprehensive guidance for AI assistants working on the Docupaca codebase.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture & Data Flow](#architecture--data-flow)
5. [Development Workflow](#development-workflow)
6. [Coding Conventions](#coding-conventions)
7. [Key Patterns & Practices](#key-patterns--practices)
8. [Database Schema](#database-schema)
9. [API Reference](#api-reference)
10. [Security Guidelines](#security-guidelines)
11. [Common Tasks](#common-tasks)
12. [Things to Avoid](#things-to-avoid)
13. [Testing](#testing)
14. [Deployment](#deployment)

---

## Project Overview

**Docupaca** is a full-stack web application that enables AI-powered OCR (Optical Character Recognition) for document processing. Users can:

- Create OCR templates with custom extraction fields
- Upload documents (PDF/images) for processing
- Use Google Gemini AI to extract structured data from documents
- Manage OCR execution history
- Integrate via external API using API keys

**Primary Language:** Japanese (UI and documentation)
**Target Users:** Business users needing automated document data extraction

---

## Tech Stack

### Frontend
- **Framework:** Next.js 16.0.1 with App Router
- **React:** 19.2.0 (React Server Components enabled)
- **TypeScript:** 5.x (strict mode)
- **Styling:** Tailwind CSS 4 (with PostCSS)
- **Icons:** lucide-react
- **PDF:** pdf-lib, pdfjs-dist, react-pdf

### Backend
- **Platform:** Firebase (Google Cloud)
  - **Authentication:** Firebase Auth
  - **Database:** Cloud Firestore (NoSQL)
  - **Storage:** Cloud Storage
  - **Functions:** Cloud Functions v2 (Node.js 20)
  - **Hosting:** Firebase Hosting with Next.js SSR

### AI/ML
- **Google Gemini API:** @google/generative-ai v0.24.1
- **Model:** gemini-2.0-flash-exp (with vision capabilities)

### Build Tools
- **Package Manager:** npm
- **Linter:** ESLint 9 with Next.js config
- **Bundler:** Webpack (via Next.js)

---

## Project Structure

```
/home/user/docupaca/
├── .github/workflows/          # CI/CD pipelines
│   ├── deploy-staging.yml      # Auto-deploy to staging on develop push
│   ├── preview.yml             # PR preview deployments
│   └── deploy-production.yml.disabled
│
├── docs/                       # Additional documentation
│   ├── CLOUD_FUNCTIONS_SETUP.md
│   ├── PDF_PREVIEW_SOLUTION.md
│   └── coding-rules/
│       └── 00-README.md
│
├── functions/                  # Firebase Cloud Functions
│   ├── src/
│   │   └── index.ts           # Main functions entry point
│   ├── package.json
│   └── tsconfig.json
│
├── public/                     # Static assets
│   ├── pdf.worker.min.mjs     # PDF.js worker
│   └── favicon.ico
│
├── src/                        # Main application source
│   ├── app/                    # Next.js App Router
│   │   ├── api/               # API Routes
│   │   │   └── analyze-document/
│   │   │       └── route.ts   # AI document analysis endpoint
│   │   ├── dashboard/         # Protected dashboard
│   │   │   ├── layout.tsx     # Dashboard layout with sidebar
│   │   │   ├── page.tsx       # Dashboard home
│   │   │   ├── settings/      # OCR settings CRUD
│   │   │   ├── history/       # OCR execution history
│   │   │   └── apikeys/       # API key management
│   │   ├── login/             # Auth pages
│   │   ├── signup/
│   │   ├── layout.tsx         # Root layout with AuthProvider
│   │   ├── page.tsx           # Root redirect page
│   │   └── globals.css        # Global styles
│   │
│   ├── components/            # Reusable React components
│   │   ├── AuthGuard.tsx      # Route protection
│   │   └── PdfPreview.tsx     # PDF display component
│   │
│   ├── context/               # React Context providers
│   │   └── AuthContext.tsx    # Global auth state
│   │
│   └── config/                # Configuration
│       ├── firebase.ts        # Client-side Firebase config
│       └── firebase-admin.ts  # Server-side Firebase Admin
│
├── firebase.json              # Firebase project configuration
├── firestore.rules            # Firestore security rules
├── storage.rules              # Cloud Storage security rules
├── next.config.ts             # Next.js configuration
├── tsconfig.json              # TypeScript configuration
├── package.json               # Dependencies
├── .env.local.example         # Environment variables template
├── README.md                  # Setup guide
├── BRANCHING_STRATEGY.md      # Git workflow
└── CLAUDE.md                  # This file
```

---

## Architecture & Data Flow

### Application Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Browser                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Next.js 16 (App Router + RSC)                │  │
│  │  - React 19 UI Components                            │  │
│  │  - AuthContext (Global State)                        │  │
│  │  - AuthGuard (Route Protection)                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                    Firebase Services                         │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │   Firebase   │  │  Firestore  │  │  Cloud Storage   │   │
│  │     Auth     │  │  Database   │  │  (Files/PDFs)    │   │
│  └──────────────┘  └─────────────┘  └──────────────────┘   │
│                           ↓ ↑                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Cloud Functions (Node.js 20)               │  │
│  │  - executeOcr (Callable)                             │  │
│  │  - ocrApi (HTTP Endpoint)                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓ ↑
┌─────────────────────────────────────────────────────────────┐
│                  Google Gemini API                          │
│             (gemini-2.0-flash-exp)                          │
│  - Vision OCR                                               │
│  - Structured Data Extraction                               │
└─────────────────────────────────────────────────────────────┘
```

### OCR Processing Flow

```
1. User uploads document (PDF/Image) → Cloud Storage
2. User triggers OCR → Cloud Function (executeOcr)
3. Cloud Function fetches file from Storage
4. Cloud Function sends to Gemini API with extraction instructions
5. Gemini returns structured data with bounding boxes
6. Cloud Function saves results to Firestore (ocr_history)
7. User views results in dashboard
```

### External API Flow

```
1. External client sends API request with Bearer token
2. Cloud Function (ocrApi) validates API key
3. File uploaded to Cloud Storage
4. Same OCR flow as above
5. Results returned in HTTP response
```

---

## Development Workflow

### Branching Strategy

The project follows a **Git Flow** branching model:

| Branch | Purpose | Protection | Auto-Deploy |
|--------|---------|------------|-------------|
| `main` | Production | 2+ reviewers | ❌ Disabled |
| `staging` | Staging environment | 1+ reviewer | ❌ Manual |
| `develop` | Development | 1+ reviewer | ✅ Staging |
| `claude/*` | Claude AI work | None | ✅ Preview |
| `feature/*` | New features | None | ✅ Preview |
| `bugfix/*` | Bug fixes | None | ✅ Preview |
| `hotfix/*` | Emergency fixes | None | No |

### Typical Development Flow

```bash
# 1. Start from develop
git checkout develop
git pull origin develop

# 2. Create feature branch
git checkout -b feature/new-feature-name

# 3. Make changes, commit frequently
git add .
git commit -m "feat: add new feature"

# 4. Push and create PR
git push -u origin feature/new-feature-name
# Create PR on GitHub: feature/new-feature-name → develop

# 5. After review & approval, merge to develop
# This triggers auto-deployment to staging
```

### Commit Message Convention

Follow **Conventional Commits** format:

```
<type>: <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style (no logic change)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Add/update tests
- `chore`: Build/tooling changes

**Examples:**
```bash
feat: OCR設定の自動生成機能を追加
fix: PDFプレビューの表示エラーを修正
docs: READMEにデプロイ手順を追加
refactor: 認証ロジックをカスタムフックに分離
```

---

## Coding Conventions

### TypeScript Guidelines

1. **Always use TypeScript** - No `.js` or `.jsx` files
2. **Strict mode enabled** - Follow strict type checking
3. **Explicit return types** for functions (when not obvious)
4. **Avoid `any`** - Use `unknown` or proper types
5. **Use interfaces** for object shapes, types for unions/intersections

**Example:**
```typescript
// ✅ Good
interface OcrSetting {
  id: string;
  name: string;
  owner_id: string;
  prompt_text: string;
  extraction_fields: ExtractionField[];
}

async function fetchSettings(userId: string): Promise<OcrSetting[]> {
  // ...
}

// ❌ Bad
function fetchSettings(userId: any): any {
  // ...
}
```

### React/Next.js Conventions

1. **Prefer Server Components** by default
2. **Use Client Components** only when needed:
   - Event handlers (onClick, onChange, etc.)
   - useState, useEffect, useContext
   - Browser APIs (localStorage, etc.)

3. **File naming:**
   - Components: PascalCase (`AuthGuard.tsx`, `PdfPreview.tsx`)
   - Pages: lowercase (`page.tsx`, `layout.tsx`)
   - Utilities: camelCase (`firebase.ts`, `useAuth.ts`)

4. **Component structure:**
```typescript
'use client' // Only if needed

import { ... } from '...'

interface ComponentProps {
  // Props definition
}

export default function ComponentName({ prop1, prop2 }: ComponentProps) {
  // Component logic
  return (
    // JSX
  )
}
```

### Firestore Conventions

1. **Collection naming:** snake_case (`ocr_settings`, `ocr_history`, `api_keys`)
2. **Field naming:** snake_case (`owner_id`, `created_at`, `file_path`)
3. **Always use Timestamp** for dates: `serverTimestamp()` or `Timestamp.now()`
4. **Document IDs:** Auto-generated or user-specific UUIDs

**Example:**
```typescript
// ✅ Good
const settingRef = await addDoc(collection(db, 'ocr_settings'), {
  name: 'Invoice Template',
  owner_id: userId,
  prompt_text: '...',
  created_at: serverTimestamp()
});

// ❌ Bad
const settingRef = await addDoc(collection(db, 'OcrSettings'), {
  Name: 'Invoice Template',
  ownerId: userId,
  createdAt: new Date().toISOString() // Wrong!
});
```

### Firebase Cloud Functions Conventions

1. **Use v2 functions** (`firebase-functions/v2`)
2. **Specify region:** `region: 'asia-northeast1'` or `'asia-east1'`
3. **Set timeouts** for long-running tasks: `timeoutSeconds: 540`
4. **Error handling:** Always try-catch and return proper error responses

**Example:**
```typescript
import { onCall } from 'firebase-functions/v2/https';

export const myFunction = onCall(
  {
    region: 'asia-northeast1',
    timeoutSeconds: 300,
    memory: '1GiB'
  },
  async (request) => {
    try {
      // Validate auth
      if (!request.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です');
      }

      // Function logic

      return { success: true, data: result };
    } catch (error) {
      console.error('Error:', error);
      throw new HttpsError('internal', 'エラーが発生しました');
    }
  }
);
```

### CSS/Styling Conventions

1. **Use Tailwind CSS** for styling
2. **Avoid custom CSS** unless absolutely necessary
3. **Use semantic color classes:** `bg-blue-500`, `text-gray-700`
4. **Responsive design:** Use `sm:`, `md:`, `lg:` prefixes

**Example:**
```tsx
// ✅ Good
<div className="flex flex-col gap-4 p-6 bg-white rounded-lg shadow-md">
  <h2 className="text-xl font-bold text-gray-800">Title</h2>
  <p className="text-gray-600">Description</p>
</div>

// ❌ Bad (avoid inline styles)
<div style={{ display: 'flex', padding: '24px' }}>
  <h2 style={{ fontSize: '20px' }}>Title</h2>
</div>
```

---

## Key Patterns & Practices

### 1. Authentication Pattern

**AuthContext** provides global authentication state:

```typescript
// src/context/AuthContext.tsx
'use client'

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

// Usage in components
const { user, loading } = useAuth();
```

**AuthGuard** protects routes:

```typescript
// src/components/AuthGuard.tsx
'use client'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading) return <div>Loading...</div>;
  if (!user) return null;

  return <>{children}</>;
}
```

### 2. Firestore Data Fetching Pattern

**Always check authentication before querying:**

```typescript
'use client'

export default function SettingsPage() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<OcrSetting[]>([]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'ocr_settings'),
      where('owner_id', '==', user.uid),
      orderBy('created_at', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as OcrSetting[];
      setSettings(data);
    });

    return unsubscribe;
  }, [user]);

  return (
    // Render settings
  );
}
```

### 3. File Upload Pattern

**Upload to Cloud Storage with proper paths:**

```typescript
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/config/firebase';

async function uploadFile(file: File, userId: string): Promise<string> {
  const storageRef = ref(storage, `users/${userId}/uploads/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(storageRef);
  return downloadURL;
}
```

### 4. API Route Pattern (Next.js)

```typescript
// src/app/api/my-endpoint/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Parse request
    const body = await request.json();

    // Validate
    if (!body.requiredField) {
      return NextResponse.json(
        { error: 'Missing required field' },
        { status: 400 }
      );
    }

    // Process
    const result = await processData(body);

    // Return success
    return NextResponse.json({ success: true, data: result });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### 5. Error Handling Pattern

**Always provide user-friendly error messages:**

```typescript
try {
  await someOperation();
} catch (error) {
  console.error('Detailed error:', error);

  // Show user-friendly message
  if (error.code === 'permission-denied') {
    alert('アクセス権限がありません');
  } else if (error.code === 'not-found') {
    alert('データが見つかりません');
  } else {
    alert('エラーが発生しました。もう一度お試しください。');
  }
}
```

---

## Database Schema

### Collection: `ocr_settings`

OCR template configurations created by users.

```typescript
interface OcrSetting {
  id: string;                    // Auto-generated document ID
  name: string;                  // Template name (e.g., "請求書テンプレート")
  owner_id: string;              // Firebase Auth UID
  prompt_text: string;           // Instructions for Gemini API
  extraction_fields: Array<{
    name: string;                // Field name (camelCase, e.g., "companyName")
    instruction: string;         // Extraction instruction
  }>;
  model_name: string;            // Gemini model (e.g., "gemini-2.0-flash-exp")
  created_at: Timestamp;         // Creation timestamp
}
```

**Indexes:**
- `owner_id` (ascending)
- `created_at` (descending)

---

### Collection: `ocr_history`

Execution history of OCR jobs.

```typescript
interface OcrHistory {
  id: string;                    // Auto-generated document ID
  setting_id: string;            // Reference to ocr_settings
  user_id: string;               // Firebase Auth UID
  status: 'processing' | 'completed' | 'failed';
  original_file_path: string;    // Cloud Storage path
  extracted_data?: {
    [fieldName: string]: {
      value: string;             // Extracted value
      bbox: [number, number, number, number];  // [x1, y1, x2, y2]
    }
  };
  error_message?: string;        // Error details if failed
  executed_at: Timestamp;        // Execution timestamp
}
```

**Indexes:**
- `user_id` (ascending), `executed_at` (descending)
- `setting_id` (ascending), `executed_at` (descending)

---

### Collection: `api_keys`

External API keys for programmatic access.

```typescript
interface ApiKey {
  id: string;                    // Auto-generated document ID
  user_id: string;               // Firebase Auth UID (owner)
  key_hash: string;              // SHA-256 hash of the key
  key_prefix: string;            // First 12 chars + "..." for display
  created_at: Timestamp;         // Creation timestamp
}
```

**Security:** Original keys are NEVER stored, only SHA-256 hashes.

**Indexes:**
- `user_id` (ascending)
- `key_hash` (ascending) - for fast lookups during auth

---

## API Reference

### Internal API Routes (Next.js)

#### POST `/api/analyze-document`

Analyzes a document using Gemini Vision API to suggest OCR settings.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body: `file` (PDF or image)

**Response:**
```typescript
{
  documentName: string;          // Suggested template name
  extractionInstruction: string; // Suggested prompt
  extractionFields: Array<{
    name: string;                // Suggested field name (camelCase)
    instruction: string;         // Suggested extraction instruction
  }>;
}
```

**Example:**
```bash
curl -X POST https://your-domain.com/api/analyze-document \
  -F "file=@invoice.pdf"
```

---

### Cloud Functions

#### `executeOcr` (Callable Function)

Executes OCR on a document using specified settings.

**Endpoint:** `firebase.functions().httpsCallable('executeOcr')`

**Parameters:**
```typescript
{
  setting_id: string;   // OCR setting document ID
  file_path: string;    // Cloud Storage path
  user_id: string;      // Firebase Auth UID
}
```

**Returns:**
```typescript
{
  success: boolean;
  history_id: string;   // Reference to ocr_history document
  extracted_data: {
    [fieldName: string]: {
      value: string;
      bbox: [number, number, number, number];
    }
  }
}
```

**Usage:**
```typescript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();
const executeOcr = httpsCallable(functions, 'executeOcr');

const result = await executeOcr({
  setting_id: 'abc123',
  file_path: 'users/uid/uploads/file.pdf',
  user_id: user.uid
});
```

---

#### `ocrApi` (HTTP Function)

HTTP endpoint for external API access.

**Endpoint:** `https://asia-northeast1-{PROJECT_ID}.cloudfunctions.net/ocrApi`

**Authentication:** Bearer token (API key from `api_keys` collection)

**Request:**
```typescript
POST /ocrApi
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  setting_id: string;   // OCR setting document ID
  file: string;         // Base64-encoded file data
  filename: string;     // Original filename
}
```

**Response:**
```typescript
{
  success: boolean;
  history_id: string;
  extracted_data: {
    [fieldName: string]: {
      value: string;
      bbox: [number, number, number, number];
    }
  }
}
```

**Example (cURL):**
```bash
curl -X POST https://asia-northeast1-YOUR-PROJECT.cloudfunctions.net/ocrApi \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "setting_id": "abc123",
    "file": "base64_encoded_data_here",
    "filename": "document.pdf"
  }'
```

**Example (Google Apps Script):**
```javascript
function callOcrApi() {
  const apiKey = 'YOUR_API_KEY';
  const settingId = 'YOUR_SETTING_ID';
  const file = DriveApp.getFileById('FILE_ID');
  const blob = file.getBlob();
  const base64 = Utilities.base64Encode(blob.getBytes());

  const response = UrlFetchApp.fetch(
    'https://asia-northeast1-YOUR-PROJECT.cloudfunctions.net/ocrApi',
    {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        setting_id: settingId,
        file: base64,
        filename: file.getName()
      })
    }
  );

  Logger.log(response.getContentText());
}
```

---

## Security Guidelines

### Critical Security Rules

⚠️ **IMPORTANT:** The project currently has **permissive security rules** for development:

```javascript
// firestore.rules & storage.rules
allow read, write: if true;  // ⚠️ DEVELOPMENT ONLY
```

### Production Security Rules

Before deploying to production, **MUST** update security rules:

#### Firestore Rules (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // OCR Settings - User can only access their own
    match /ocr_settings/{settingId} {
      allow read, write: if request.auth != null
        && request.auth.uid == resource.data.owner_id;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.owner_id;
    }

    // OCR History - User can only read their own
    match /ocr_history/{historyId} {
      allow read: if request.auth != null
        && request.auth.uid == resource.data.user_id;
      allow write: if false;  // Only Cloud Functions can write
    }

    // API Keys - User can only access their own
    match /api_keys/{keyId} {
      allow read, delete: if request.auth != null
        && request.auth.uid == resource.data.user_id;
      allow create: if request.auth != null
        && request.auth.uid == request.resource.data.user_id;
      allow update: if false;  // Keys are immutable
    }
  }
}
```

#### Storage Rules (`storage.rules`)

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // User uploads - Users can only access their own files
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}
```

### Security Best Practices

1. **Never commit secrets** to Git:
   - Use `.env.local` (already in `.gitignore`)
   - Use Firebase Secret Manager for Cloud Functions

2. **API Key Security:**
   - Keys are SHA-256 hashed before storage
   - Original keys shown only once during creation
   - Implement rate limiting (TODO: not yet implemented)

3. **Input Validation:**
   - Always validate user input on server-side
   - Sanitize file uploads (check file type, size)
   - Use TypeScript for compile-time type safety

4. **Authentication:**
   - Always check `request.auth` in Cloud Functions
   - Use AuthGuard for protected frontend routes
   - Never trust client-side auth checks alone

5. **CORS:**
   - Cloud Functions have CORS enabled for API endpoint
   - Restrict origins in production (currently allows all)

---

## Common Tasks

### Task 1: Add a New OCR Field to Extraction

**File:** `src/app/dashboard/settings/new/page.tsx` or `edit/[id]/page.tsx`

1. Fields are dynamic - no code change needed
2. Users add fields via UI in "抽出フィールド" section
3. Each field has `name` (camelCase) and `instruction`

---

### Task 2: Add a New Page to Dashboard

```bash
# 1. Create new directory under dashboard
mkdir -p src/app/dashboard/my-new-page

# 2. Create page.tsx
cat > src/app/dashboard/my-new-page/page.tsx << 'EOF'
'use client'

import { useAuth } from '@/context/AuthContext';

export default function MyNewPage() {
  const { user } = useAuth();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">新しいページ</h1>
      <p>User: {user?.email}</p>
    </div>
  );
}
EOF

# 3. Add to sidebar navigation
# Edit: src/app/dashboard/layout.tsx
# Add link in sidebar:
<Link href="/dashboard/my-new-page" className="...">
  <Icon className="mr-2 h-4 w-4" />
  新しいページ
</Link>
```

---

### Task 3: Update Firestore Security Rules

```bash
# 1. Edit firestore.rules
nano firestore.rules

# 2. Test rules locally
firebase emulators:start

# 3. Deploy to staging
firebase deploy --only firestore:rules --project staging

# 4. Verify in Firebase Console
# 5. Deploy to production (when ready)
firebase deploy --only firestore:rules --project production
```

---

### Task 4: Add a New Cloud Function

```typescript
// functions/src/index.ts

import { onCall } from 'firebase-functions/v2/https';

export const myNewFunction = onCall(
  {
    region: 'asia-northeast1',
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    // Validate auth
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '認証が必要です');
    }

    const { param1 } = request.data;

    // Your logic here

    return { success: true, result: 'value' };
  }
);
```

```bash
# Build and deploy
cd functions
npm run build
firebase deploy --only functions:myNewFunction
```

---

### Task 5: Add Environment Variable

```bash
# 1. Add to .env.local
echo "NEW_VARIABLE=value" >> .env.local

# 2. Add to .env.local.example
echo "NEW_VARIABLE=your_value_here" >> .env.local.example

# 3. For Cloud Functions, use Secret Manager:
firebase functions:secrets:set NEW_SECRET

# 4. Access in functions:
import { defineSecret } from 'firebase-functions/params';
const newSecret = defineSecret('NEW_SECRET');

export const myFunction = onCall(
  { secrets: [newSecret] },
  async (request) => {
    const value = newSecret.value();
    // Use value
  }
);
```

---

### Task 6: Run Local Development

```bash
# Terminal 1: Start Firebase emulators
firebase emulators:start

# Terminal 2: Start Next.js dev server
npm run dev

# Access:
# - Next.js: http://localhost:3000
# - Firestore UI: http://localhost:4000/firestore
# - Functions: http://localhost:5001
```

---

## Things to Avoid

### ❌ Don't Do These

1. **Don't push directly to `main` or `develop`**
   - Always create a feature branch
   - Always create a PR for review

2. **Don't commit `.env.local` or secrets**
   - Already in `.gitignore`, but double-check

3. **Don't use `any` type in TypeScript**
   - Use proper types or `unknown` if necessary

4. **Don't skip error handling**
   - Always wrap async operations in try-catch
   - Provide user-friendly error messages

5. **Don't fetch Firestore data without auth check**
   ```typescript
   // ❌ Bad
   const settings = await getDocs(collection(db, 'ocr_settings'));

   // ✅ Good
   if (!user) return;
   const q = query(
     collection(db, 'ocr_settings'),
     where('owner_id', '==', user.uid)
   );
   const settings = await getDocs(q);
   ```

6. **Don't use inline styles**
   - Use Tailwind CSS classes instead

7. **Don't create Server Components with client hooks**
   ```typescript
   // ❌ Bad - Server Component using useState
   export default function MyPage() {
     const [state, setState] = useState(0); // Error!
   }

   // ✅ Good - Mark as Client Component
   'use client'
   export default function MyPage() {
     const [state, setState] = useState(0);
   }
   ```

8. **Don't deploy to production without testing**
   - Test in local emulators
   - Deploy to staging first
   - Verify functionality before production

9. **Don't skip TypeScript type definitions**
   ```typescript
   // ❌ Bad
   function processData(data) {
     return data.map(item => item.value);
   }

   // ✅ Good
   interface DataItem {
     value: string;
   }
   function processData(data: DataItem[]): string[] {
     return data.map(item => item.value);
   }
   ```

10. **Don't use `console.log` in production**
    - Use proper logging in Cloud Functions
    - Remove debug logs before committing

---

## Testing

### Current Status

⚠️ **No testing framework configured yet**

### Recommended Setup

```bash
# Install Jest and React Testing Library
npm install --save-dev jest @testing-library/react @testing-library/jest-dom jest-environment-jsdom

# Install Firebase testing utilities
npm install --save-dev @firebase/rules-unit-testing

# Create jest.config.js
cat > jest.config.js << 'EOF'
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

module.exports = createJestConfig(customJestConfig)
EOF

# Add test script to package.json
npm pkg set scripts.test="jest"
npm pkg set scripts.test:watch="jest --watch"
```

### Test File Locations

```
src/
├── app/
│   └── api/
│       └── analyze-document/
│           ├── route.ts
│           └── route.test.ts        # API route tests
├── components/
│   ├── AuthGuard.tsx
│   └── AuthGuard.test.tsx          # Component tests
└── __tests__/                       # Integration tests
    └── auth.test.ts
```

---

## Deployment

### Environments

| Environment | Branch | URL | Firebase Project |
|-------------|--------|-----|------------------|
| Production | `main` | TBD | TBD |
| Staging | `develop` | Auto-deployed | Staging project |
| Preview | PRs | Auto-generated | Staging project |

### Deployment Commands

```bash
# Full deployment (Next.js + Functions + Rules)
npm run build
cd functions && npm run build && cd ..
firebase deploy

# Deploy specific targets
firebase deploy --only hosting           # Next.js app only
firebase deploy --only functions         # Cloud Functions only
firebase deploy --only firestore:rules   # Firestore rules only
firebase deploy --only storage:rules     # Storage rules only

# Deploy to specific project
firebase deploy --project staging
firebase deploy --project production
```

### CI/CD Pipeline

**Staging Auto-Deploy:**
- Trigger: Push to `develop` branch
- Workflow: `.github/workflows/deploy-staging.yml`
- Steps: Install → Lint → Build → Deploy to Firebase

**PR Preview:**
- Trigger: Pull Request created/updated
- Workflow: `.github/workflows/preview.yml`
- Creates temporary preview environment

**Required GitHub Secrets:**
```
STAGING_FIREBASE_PROJECT_ID
STAGING_FIREBASE_SERVICE_ACCOUNT
STAGING_FIREBASE_TOKEN
```

See `GITHUB_SECRETS_SETUP.md` for setup instructions.

### Pre-Deployment Checklist

Before deploying to production:

- [ ] Update Firestore security rules (remove `allow read, write: if true`)
- [ ] Update Storage security rules (remove `allow read, write: if true`)
- [ ] Set up Firebase Secret Manager for Gemini API key
- [ ] Configure custom domain (if any)
- [ ] Enable Firebase App Check (optional, recommended)
- [ ] Set up monitoring and alerts
- [ ] Update environment variables in GitHub Secrets
- [ ] Test all features in staging environment
- [ ] Run security audit: `npm audit`
- [ ] Update documentation

---

## Additional Resources

### Documentation Files

- **README.md** - Project setup guide
- **BRANCHING_STRATEGY.md** - Git workflow and commit conventions
- **GITHUB_SECRETS_SETUP.md** - CI/CD configuration
- **PR_DESCRIPTION.md** - Pull request template
- **docs/CLOUD_FUNCTIONS_SETUP.md** - Cloud Functions guide
- **docs/PDF_PREVIEW_SOLUTION.md** - PDF preview implementation
- **docs/coding-rules/00-README.md** - Detailed coding standards

### External Links

- [Next.js 16 Documentation](https://nextjs.org/docs)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Cloud Functions v2](https://firebase.google.com/docs/functions)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2025-11-14 | 1.0.0 | Initial CLAUDE.md creation |

---

## Contact & Support

For questions or issues:
- Check existing documentation in `/docs`
- Review GitHub Issues
- Contact repository maintainers

---

**END OF CLAUDE.md**
