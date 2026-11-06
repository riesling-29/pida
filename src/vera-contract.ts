// Reused producer-owned closed schemas, read-only source snapshot 2026-11-03.
// Core schema SHA256 a6a652fc73bbfc00713dc5142d261b903f92f70c129fccdd4f74e136604b5c6f
// Vera schema SHA256 51f7ff694a16fe39591f53ed6fab2dbe555ac8c61e09c650f077a086c6a813f7

export const veraBindingJsonSchema = {
  "type": "object",
  "properties": {
    "agent_instance_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "project_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "organization_session_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "task_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "attempt_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "run_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "host_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "memory_scope": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^(personal|project|organization):[A-Za-z0-9._-]{1,100}$"
      },
      "minItems": 1,
      "maxItems": 64,
      "uniqueItems": true
    },
    "schema_version": {
      "const": "1.0.0"
    },
    "binding_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "persona_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "principal": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "recorded_at": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "agent_instance_id",
    "project_id",
    "organization_session_id",
    "task_id",
    "attempt_id",
    "run_id",
    "host_id",
    "memory_scope",
    "schema_version",
    "binding_id",
    "persona_id",
    "principal",
    "recorded_at"
  ],
  "additionalProperties": false
};

export const veraContextJsonSchema = {
  "type": "object",
  "properties": {
    "schema_version": {
      "const": "vera-continuity/0.2.0"
    },
    "context_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "binding_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "persona_id": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "identity_revision": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "memory_revision": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "memory_refs": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
        "maxLength": 128
      },
      "minItems": 0,
      "maxItems": 256,
      "uniqueItems": true
    },
    "state_ref": {
      "anyOf": [
        {
          "type": "string",
          "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
          "maxLength": 128
        },
        {
          "type": "null"
        }
      ]
    },
    "source_refs": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 256
      },
      "minItems": 0,
      "maxItems": 512,
      "uniqueItems": true
    },
    "renderer_version": {
      "enum": [
        "vera-json/1",
        "vera-reference-text/1"
      ]
    },
    "budget": {
      "type": "object",
      "properties": {
        "unit": {
          "const": "utf8_bytes"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "used": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "unit",
        "limit",
        "used"
      ],
      "additionalProperties": false
    },
    "omitted": {
      "type": "object",
      "properties": {
        "memories": {
          "type": "integer",
          "minimum": 0
        },
        "working_state": {
          "type": "boolean"
        }
      },
      "required": [
        "memories",
        "working_state"
      ],
      "additionalProperties": false
    },
    "truncated": {
      "type": "boolean"
    },
    "scopes": {
      "type": "array",
      "items": {
        "type": "string",
        "pattern": "^(personal|project|organization):[A-Za-z0-9._-]{1,100}$"
      },
      "minItems": 1,
      "maxItems": 64,
      "uniqueItems": true
    },
    "text": {
      "type": "string",
      "minLength": 1,
      "maxLength": 60000
    },
    "text_digest": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "digest": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "created_at": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "valid_until": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "branch": {
      "type": "string",
      "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
      "maxLength": 128
    },
    "head_revision": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "model_refs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "maxLength": 128
          },
          "revision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "required": [
          "id",
          "revision",
          "digest"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 64,
      "uniqueItems": true
    },
    "analysis_refs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "maxLength": 128
          },
          "revision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "required": [
          "id",
          "revision",
          "digest"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 64,
      "uniqueItems": true
    },
    "artifact_refs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
            "maxLength": 128
          },
          "revision": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "digest": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          }
        },
        "required": [
          "id",
          "revision",
          "digest"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 256,
      "uniqueItems": true
    },
    "model_activations": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "model_ref": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "pattern": "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$",
                "maxLength": 128
              },
              "revision": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              "digest": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              }
            },
            "required": [
              "id",
              "revision",
              "digest"
            ],
            "additionalProperties": false
          },
          "status_revision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "active_revision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          }
        },
        "required": [
          "model_ref",
          "status_revision",
          "active_revision"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 64,
      "uniqueItems": true
    }
  },
  "required": [
    "schema_version",
    "context_id",
    "binding_id",
    "persona_id",
    "identity_revision",
    "memory_revision",
    "memory_refs",
    "state_ref",
    "source_refs",
    "renderer_version",
    "budget",
    "omitted",
    "truncated",
    "scopes",
    "text",
    "text_digest",
    "digest",
    "created_at",
    "valid_until",
    "branch",
    "head_revision",
    "model_refs",
    "analysis_refs",
    "artifact_refs",
    "model_activations"
  ],
  "additionalProperties": false
};
