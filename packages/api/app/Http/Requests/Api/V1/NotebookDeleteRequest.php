<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

final class NotebookDeleteRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'onDestroyRemoveContents' => ['sometimes', 'boolean'],
            'moveNotesTo' => ['sometimes', 'string', 'min:1'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if ($this->exists('moveNotesTo') && $this->boolean('onDestroyRemoveContents')) {
                $validator->errors()->add(
                    'moveNotesTo',
                    'Send moveNotesTo or onDestroyRemoveContents, not both.',
                );
            }
        });
    }
}
