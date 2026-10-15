<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Exceptions\ApiHttpException;
use App\Services\Collab\YjsBytes;
use App\Services\Collab\YjsPayloadException;
use Illuminate\Foundation\Http\FormRequest;

final class NoteCollaborativePutRequest extends FormRequest
{
    /** Decoded Yjs bytes stashed before validation flattens the number list. */
    public const YJS_BYTES = 'note_yjs_bytes';

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'markdown' => ['required', 'string'],
            'title' => ['sometimes', 'string', 'max:1024'],
            // The shared save sends the room id. Notes addresses the note by the path.
            'room' => ['sometimes', 'string'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (! $this->exists('yjs')) {
            throw new ApiHttpException(400, 'Yjs state is required.', 'bad_request');
        }

        try {
            $bytes = YjsBytes::decode($this->input('yjs'));
        } catch (YjsPayloadException $e) {
            throw new ApiHttpException(
                $e->status,
                $e->status === 413
                    ? 'Yjs state exceeds the 5 MiB limit.'
                    : 'Yjs state must be a list of bytes from 0 to 255.',
                $e->status === 413 ? 'payload_too_large' : 'bad_request',
            );
        }

        $this->attributes->set(self::YJS_BYTES, $bytes);
        $this->json()->remove('yjs');
        $this->request->remove('yjs');
    }

    public function yjsBytes(): string
    {
        $bytes = $this->attributes->get(self::YJS_BYTES);

        return is_string($bytes) ? $bytes : '';
    }
}
