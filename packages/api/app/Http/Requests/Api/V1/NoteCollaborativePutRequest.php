<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Exceptions\ApiHttpException;
use App\Services\Collab\FramedPayload;
use App\Services\Collab\YjsBytes;
use Illuminate\Foundation\Http\FormRequest;

final class NoteCollaborativePutRequest extends FormRequest
{
    /** Decoded Yjs bytes. The frame tail is binary, so it never enters validation. */
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
        ];
    }

    protected function prepareForValidation(): void
    {
        $fields = FramedPayload::collaborationFields($this->getContent());
        if (! array_key_exists('markdown', $fields)) {
            throw new ApiHttpException(400, 'Markdown is required.', 'bad_request');
        }
        if (! array_key_exists('yjs', $fields)) {
            throw new ApiHttpException(400, 'Yjs state is required.', 'bad_request');
        }
        if (strlen($fields['yjs']) > YjsBytes::MAX_BYTES) {
            throw new ApiHttpException(413, 'Yjs state exceeds the 5 MiB limit.', 'payload_too_large');
        }

        $this->attributes->set(self::YJS_BYTES, $fields['yjs']);
        $input = ['markdown' => $fields['markdown']];
        if (array_key_exists('title', $fields)) {
            $input['title'] = $fields['title'];
        }
        $this->merge($input);
    }

    public function yjsBytes(): string
    {
        $bytes = $this->attributes->get(self::YJS_BYTES);

        return is_string($bytes) ? $bytes : '';
    }
}
